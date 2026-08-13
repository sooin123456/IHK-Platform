using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using THEKIE.Qto.Commands;
using THEKIE.Qto.Compat;
using THEKIE.Qto.Core;

namespace THEKIE.Qto.RevitStubTest
{
    internal static class Program
    {
        private static int Main()
        {
            try
            {
                var document = new Document { Title = "stub" };
                var typeId = Id(10);
                var levelId = Id(20);
                document.Add(new ElementType { Id = typeId, FamilyName = "Basic Wall", Name = "Concrete 200" });
                document.Add(new Element { Id = levelId, Name = "L1" });
                var first = Wall(101, typeId, levelId, 10, 12.5, 0);
                var second = Wall(102, typeId, levelId, 5, 2.5, 0);
                document.Add(first);
                document.Add(second);

                var rows = QuantityExtractor.Extract(document);
                Assert(rows.Count == 1, "single aggregate row");
                var row = rows.Single();
                Assert(row.Category == "Walls" && row.Count == 2 && row.VolumeM3 == 15 && row.AreaM2 == 15 && row.ElementIds.SequenceEqual(new long[] { 101, 102 }), "quantity aggregation, normalized category, and traceability");
                TestPropertiesScopesAndEvidence();
                TestElementQuantityLedger();
                TestElementPropertiesExport(document);
                TestFormworkFaceLedger();
                TestQtoCsvRoundTrip(rows);
                TestQtoCsvFormulaNeutralization();
                TestEmptyQtoCsvRoundTrip();
                TestIfcExport(document);
                TestIfcQtoPackage(document);
#if REVIT2017 || REVIT2022 || REVIT2023
                Assert(RevitCompat.GetIdValue(Id(101)) == 101L, "2017-2023 integer element id");
#else
                Assert(RevitCompat.GetIdValue(Id(4294967296L)) == 4294967296L, "2024+ long element id");
#endif
                Console.WriteLine("Revit stub test passed.");
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex);
                return 1;
            }
        }

        private static void TestQtoCsvFormulaNeutralization()
        {
            string path = Path.Combine(Path.GetTempPath(), "lukas-qto-formula-stub.csv");
            try
            {
                var row = new QtoRow
                {
                    Category = "=CATEGORY()",
                    FamilyName = " +FAMILY()",
                    TypeName = "-TYPE()",
                    Level = "\t@LEVEL()",
                    Count = 1,
                    VolumeM3 = 2,
                    AreaM2 = 3,
                    LengthM = 4
                };
                row.ElementIds.Add(101);
                string auditKey = row.AuditKey;
                CsvWriter.Write(path, new[] { row });
                string[] values = Csv.Read(path).Skip(1).Single();
                Assert(values[0] == auditKey && values[1] == "'=CATEGORY()" && values[2] == " '+FAMILY()" &&
                       values[3] == "'-TYPE()" && values[4] == "\t'@LEVEL()", "QTO user text neutralizes spreadsheet formulas without changing the machine key");
                Assert(values[5] == "1" && values[6] == "2" && values[7] == "3" && values[8] == "4" && values[9] == "101", "QTO numeric fields and element IDs are unchanged");
            }
            finally
            {
                if (File.Exists(path)) File.Delete(path);
            }
        }

        private static void TestFormworkFaceLedger()
        {
            var document = new Document { Title = "formwork-face" };
            ElementId typeId = Id(601);
            document.Add(new ElementType { Id = typeId, FamilyName = "Wall", Name = "Concrete Wall" });
            var wall = new Element { Id = Id(602), TypeId = typeId, Category = new Category { Name = "Walls", CategoryType = CategoryType.Model }, Name = "Concrete Wall" };
            var direct = new Solid();
            direct.Faces.Add(new Face { Area = 12.5d, Reference = new Reference { StableRepresentation = "602:FACE:0" } });
            var nested = new Solid();
            nested.Faces.Add(new Face { Area = 3d });
            var geometry = new GeometryElement(); geometry.Add(direct); geometry.Add(new GeometryInstance { InstanceGeometry = new GeometryElement() });
            ((GeometryInstance)geometry.Last()).InstanceGeometry.Add(nested);
            wall.Geometry = geometry; document.Add(wall);

            var faces = FormworkFaceExtractor.Extract(document);
            Assert(faces.Count == 2 && faces[0].FaceId == "602:FACE:0" && faces.All(face => face.AreaBasis == FormworkAreaBasis.Gross &&
                face.BoundaryKind == FormworkBoundaryKind.Unknown && face.Decision == FormworkDecision.Review && face.OpeningUnionAreaM2 == 0m),
                "solid and nested solid faces become review-only gross evidence rows");
            Assert(faces.Any(face => face.FaceId.Contains("element=602;solid=1;face=0")) && faces.All(face => face.Category == "Walls" &&
                face.MaterialEvidence.StartsWith("UNRESOLVED") && face.OrientationEvidence.StartsWith("UNRESOLVED")),
                "stable references fall back deterministically and unresolved material/orientation are explicit");
            Assert(FormworkTakeoff.Calculate(faces, new FormworkAccessoryRow[0], new StructuralEvidenceRegistry()).Status == StructuralQuantityStatus.REVIEW,
                "geometry evidence cannot infer contact or openings into a formwork pass");
            string path = Path.Combine(Path.GetTempPath(), "lukas-formwork-face-" + Guid.NewGuid().ToString("N") + ".csv");
            try
            {
                FormworkFaceExtractor.WriteLedger(path, faces);
                string[] header = Csv.Read(path)[0];
                Assert(header.Length == 13 && header[0] == "face_id" && header[7] == "face_area_m2" && Csv.Read(path).Count == 3,
                    "formwork face evidence writes a dedicated ledger instead of generic AreaM2");
            }
            finally { if (File.Exists(path)) File.Delete(path); }

            string folder = Path.Combine(Path.GetTempPath(), "lukas-formwork-export-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(folder);
            try
            {
                string ledgerPath = Path.Combine(folder, "formwork-face-ledger.csv");
                string manifestPath; string error;
                Result result = ExportFormworkFaceLedgerCommand.CreateLedger(document, ledgerPath, new DateTime(2026, 8, 13, 1, 2, 3, DateTimeKind.Utc), "2026", out manifestPath, out error);
                Assert(result == Result.Succeeded && File.Exists(ledgerPath) && File.Exists(manifestPath), "formwork face command atomically publishes dedicated ledger and manifest");
                string[][] manifest = Csv.Read(manifestPath).ToArray();
                Assert(manifest.Length == 2 && manifest[0].Length == 8 && manifest[0][4] == "ledger_sha256" && manifest[1][3] == "formwork-face-ledger.csv" && manifest[1][6] == "2" && manifest[1][7] == "REVIEW", "formwork manifest binds CSV hash, canonical ledger hash, row count, and review state");
                Assert(manifest[1][4] == Hash(ledgerPath) && manifest[1][5] == FormworkTakeoff.ComputeLedgerHash(FormworkFaceExtractor.Extract(document)), "formwork manifest detects ledger-byte and canonical-geometry identities");
                result = ExportFormworkFaceLedgerCommand.CreateLedger(document, ledgerPath, DateTime.UtcNow, "2026", out manifestPath, out error);
                Assert(result == Result.Failed && File.Exists(ledgerPath), "formwork face export refuses collisions without overwrite");
                wall.Geometry = new GeometryElement();
                result = ExportFormworkFaceLedgerCommand.CreateLedger(document, Path.Combine(folder, "empty.csv"), DateTime.UtcNow, "2026", out manifestPath, out error);
                Assert(result == Result.Failed && !File.Exists(Path.Combine(folder, "empty.csv")), "empty solid geometry cannot publish a ledger");
            }
            finally { Directory.Delete(folder, true); }
            FileSaveDialog.NextResult = ItemSelectionDialogResult.Canceled;
            string message = null;
            Result cancelled = new ExportFormworkFaceLedgerCommand().Execute(new ExternalCommandData { Application = new UIApplication { ActiveUIDocument = new UIDocument { Document = document } } }, ref message, new ElementSet());
            Assert(cancelled == Result.Cancelled, "formwork face export cancellation has no output side effect");
            FileSaveDialog.NextResult = ItemSelectionDialogResult.Confirmed;
        }

        private static void TestElementQuantityLedger()
        {
            var document = new Document { Title = "element-ledger" };
            ElementId typeId = Id(30);
            ElementId levelId = Id(31);
            document.Add(new ElementType { Id = typeId, FamilyName = "  @Family", Name = "'Type" });
            document.Add(new Element { Id = levelId, Name = "+L1" });
            var computed = Wall(201, typeId, levelId, 3, 0, 0);
            computed.Category.Name = "=Walls";
            computed.Name = "-Computed wall";
            computed.SetParameter(BuiltInParameter.INSTANCE_LENGTH_PARAM, Number(7));
            computed.SetParameter(BuiltInParameter.WALL_USER_HEIGHT_PARAM, Number(4));
            var zero = Wall(202, typeId, levelId, 0, 0, 0);
            zero.SetParameter(BuiltInParameter.INSTANCE_LENGTH_PARAM, Number(9));
            var missing = new Element { Id = Id(203), TypeId = typeId, LevelId = levelId, Category = new Category { Name = "Walls", CategoryType = CategoryType.Model }, Name = "Wall" };
            document.Add(computed); document.Add(zero); document.Add(missing);

            var rows = ElementQuantityExtractor.Extract(document);
            ElementQuantityLedgerRow computedRow = rows.Single(x => x.ElementId == "201");
            ElementQuantityLedgerRow zeroRow = rows.Single(x => x.ElementId == "202");
            ElementQuantityLedgerRow missingRow = rows.Single(x => x.ElementId == "203");
            Assert(computedRow.VolumeState == ElementVolumeState.COMPUTED && computedRow.VolumeM3 == 3m && computedRow.SourceParameter == "HOST_VOLUME_COMPUTED", "element extractor selects first valid volume parameter");
            Assert(zeroRow.VolumeState == ElementVolumeState.ZERO && zeroRow.VolumeM3 == 0m && zeroRow.SourceParameter == "HOST_VOLUME_COMPUTED", "element extractor preserves zero and does not fall through to a later positive parameter");
            Assert(missingRow.VolumeState == ElementVolumeState.MISSING && !missingRow.VolumeM3.HasValue && missingRow.SourceParameter == null, "element extractor preserves missing separately from zero");
            Assert(computedRow.LengthState == ElementVolumeState.ZERO && computedRow.LengthM == 0m && computedRow.LengthSourceParameter == "CURVE_ELEM_LENGTH" &&
                computedRow.HeightState == ElementVolumeState.COMPUTED && computedRow.HeightM == 4m && computedRow.HeightSourceParameter == "WALL_USER_HEIGHT_PARAM" &&
                zeroRow.LengthState == ElementVolumeState.ZERO && zeroRow.LengthM == 0m && zeroRow.HeightState == ElementVolumeState.MISSING && !zeroRow.HeightM.HasValue &&
                missingRow.LengthState == ElementVolumeState.MISSING && !missingRow.LengthM.HasValue && missingRow.HeightState == ElementVolumeState.MISSING && !missingRow.HeightM.HasValue,
                "length and height preserve their own zero and missing states without fallback");
            Assert(computedRow.Category == "=Walls" && computedRow.Family == "  @Family" && computedRow.Type == "'Type" && computedRow.ElementName == "-Computed wall" && computedRow.Level == "+L1", "element extractor preserves raw identity metadata without material/spec inference");

            string path = Path.Combine(Path.GetTempPath(), "lukas-element-ledger-" + Guid.NewGuid().ToString("N") + ".csv");
            try
            {
                ElementQuantityLedger.Write(path, rows);
                var restored = ElementQuantityLedger.Read(path);
                Assert(restored.Count == 3 && restored.Single(x => x.ElementId == "201").Category == "=Walls" && restored.Single(x => x.ElementId == "201").HeightM == 4m && Csv.Read(path)[1][1] == "'=Walls", "Revit element ledger writes safe CSV and round-trips");
            }
            finally { if (File.Exists(path)) File.Delete(path); }

            AssertInvalidVolume(-1d, "negative element volume");
            AssertInvalidVolume(double.NaN, "NaN element volume");
            AssertInvalidVolume(double.PositiveInfinity, "infinite element volume");
        }

        private static void TestElementPropertiesExport(Document document)
        {
            string path = Path.Combine(Path.GetTempPath(), "lukas-element-properties-" + Guid.NewGuid().ToString("N") + ".csv");
            try
            {
                FileSaveDialog.NextPath = path;
                FileSaveDialog.NextResult = ItemSelectionDialogResult.Confirmed;
                string message = null;
                Result result = new ExportElementPropertiesCommand().Execute(new ExternalCommandData {
                    Application = new UIApplication { ActiveUIDocument = new UIDocument { Document = document } }
                }, ref message, new ElementSet());
                System.Collections.Generic.IReadOnlyList<ElementQuantityLedgerRow> rows = ElementQuantityLedger.Read(path);
                Assert(result == Result.Succeeded && rows.Count == 2 && rows.All(x => x.LengthState == ElementVolumeState.ZERO && x.HeightState == ElementVolumeState.MISSING),
                    "properties command publishes one raw Properties row per model element");
                result = new ExportElementPropertiesCommand().Execute(new ExternalCommandData {
                    Application = new UIApplication { ActiveUIDocument = new UIDocument { Document = document } }
                }, ref message, new ElementSet());
                Assert(result == Result.Failed && File.Exists(path), "properties command refuses an existing CSV without overwrite");
                FileSaveDialog.NextResult = ItemSelectionDialogResult.Canceled;
                result = new ExportElementPropertiesCommand().Execute(new ExternalCommandData {
                    Application = new UIApplication { ActiveUIDocument = new UIDocument { Document = document } }
                }, ref message, new ElementSet());
                Assert(result == Result.Cancelled, "properties command cancellation has no output side effect");
                FileSaveDialog.NextResult = ItemSelectionDialogResult.Confirmed;
            }
            finally { if (File.Exists(path)) File.Delete(path); if (File.Exists(path + ".evidence.json")) File.Delete(path + ".evidence.json"); }
        }

        private static void TestPropertiesScopesAndEvidence()
        {
            var document = new Document { Title = "scoped-properties" };
            ElementId typeId = Id(501); document.Add(new ElementType { Id = typeId, FamilyName = "Wall", Name = "Concrete" });
            Element host = Wall(502, typeId, null, 2, 0, 0);
            var link = new RevitLinkInstance { Id = Id(503), TypeId = typeId, Category = new Category { Name = "Revit Links", CategoryType = CategoryType.Model }, Name = "Linked model" };
            document.Add(host); document.Add(link);
            var selection = new[] { host.Id, link.Id, Id(999) };
            var counts = new RevitExtractionCounts();
            var selected = ElementQuantityExtractor.Extract(document, RevitExtractionScope.Selection, null, selection, counts);
            Assert(selected.Count == 1 && selected[0].ElementId == "502" && counts.CandidateCount == 2 && counts.ExcludedLinkInstanceCount == 1 && counts.MissingSelectionIdCount == 1,
                "selection Properties scope excludes link instances and records skipped/missing selection evidence");
            counts = new RevitExtractionCounts();
            var all = ElementQuantityExtractor.Extract(document, RevitExtractionScope.EntireHostModel, null, null, counts);
            Assert(all.Count == 1 && counts.ExcludedLinkInstanceCount == 1 && counts.EligibleHostModelCount == 1,
                "entire-host-model Properties scope never traverses or exports link models");

            string path = Path.Combine(Path.GetTempPath(), "lukas-properties-scope-" + Guid.NewGuid().ToString("N") + ".csv");
            try
            {
                FileSaveDialog.NextPath = path; FileSaveDialog.NextResult = ItemSelectionDialogResult.Confirmed; TaskDialog.NextResult = TaskDialogResult.CommandLink1;
                var ui = new UIDocument { Document = document, ActiveView = new View { Id = Id(504) } }; ui.Selection.SetElementIds(selection);
                string message = null;
                Result result = new ExportElementPropertiesCommand().Execute(new ExternalCommandData { Application = new UIApplication { ActiveUIDocument = ui, Application = new Autodesk.Revit.ApplicationServices.Application { VersionNumber = "2025", VersionBuild = "2025.1.2" } } }, ref message, new ElementSet());
                string evidence = File.ReadAllText(path + ".evidence.json");
                Assert(result == Result.Succeeded && ElementQuantityLedger.Read(path).Count == 1 && evidence.Contains("\"revit_version\": \"2025\"") && evidence.Contains("\"revit_build\": \"2025.1.2\"") &&
                    evidence.Contains("\"scope\": \"Selection\"") && evidence.Contains("\"excluded_link_instances\": 1") && evidence.Contains("\"csv_rows\": 1"),
                    "Properties command writes Revit version/build, chosen scope, and host/link counts in evidence JSON without changing CSV contract");
                TaskDialog.NextResult = TaskDialogResult.CommandLink3;
            }
            finally { if (File.Exists(path)) File.Delete(path); if (File.Exists(path + ".evidence.json")) File.Delete(path + ".evidence.json"); }
        }

        private static void AssertInvalidVolume(double value, string name)
        {
            var document = new Document();
            ElementId typeId = Id(40);
            document.Add(new ElementType { Id = typeId, FamilyName = "F", Name = "T" });
            var element = new Element { Id = Id(204), TypeId = typeId, Category = new Category { Name = "Walls", CategoryType = CategoryType.Model }, Name = "Wall" };
            element.SetParameter(BuiltInParameter.HOST_VOLUME_COMPUTED, Number(value));
            document.Add(element);
            bool rejected = false;
            try { ElementQuantityExtractor.Extract(document); } catch (InvalidOperationException) { rejected = true; }
            Assert(rejected, name + " is rejected instead of falling through");
        }

        private static Element Wall(long id, ElementId typeId, ElementId levelId, double volume, double area, double length)
        {
            var element = new Element { Id = Id(id), TypeId = typeId, LevelId = levelId, Category = new Category { Name = "  Walls  ", CategoryType = CategoryType.Model }, Name = "Wall" };
            element.SetParameter(BuiltInParameter.HOST_VOLUME_COMPUTED, Number(volume));
            element.SetParameter(BuiltInParameter.HOST_AREA_COMPUTED, Number(area));
            element.SetParameter(BuiltInParameter.CURVE_ELEM_LENGTH, Number(length));
            return element;
        }

        private static Parameter Number(double value) { return new Parameter { HasValue = true, StorageType = StorageType.Double, Value = value }; }
        private static ElementId Id(long value) { return new ElementId { Value = value, IntegerValue = (int)value }; }
        private static void Assert(bool condition, string name) { if (!condition) throw new InvalidOperationException("Revit stub test failed: " + name); }

        private static void TestQtoCsvRoundTrip(System.Collections.Generic.IEnumerable<QtoRow> rows)
        {
            string path = Path.Combine(Path.GetTempPath(), "lukas-qto-stub.csv");
            try
            {
                CsvWriter.Write(path, rows);
                var qto = Input.ReadQto(path).Single();
                Assert(qto.Count == 2 && qto.VolumeM3 == 15m && qto.AreaM2 == 15m && qto.ElementIds.SequenceEqual(new[] { "101", "102" }), "QTO CSV round trip and element IDs");
            }
            finally
            {
                if (File.Exists(path)) File.Delete(path);
            }
        }

        private static void TestEmptyQtoCsvRoundTrip()
        {
            string path = Path.Combine(Path.GetTempPath(), "lukas-qto-empty-stub.csv");
            try
            {
                CsvWriter.Write(path, new QtoRow[0]);
                Assert(Input.ReadQto(path).Count == 0, "empty model produces a valid header-only QTO CSV");
            }
            finally
            {
                if (File.Exists(path)) File.Delete(path);
            }
        }

        private static void TestIfcExport(Document document)
        {
            string folder = Path.GetTempPath();
            FileSaveDialog.NextPath = Path.Combine(folder, "lukas-stub.ifc");
            FileSaveDialog.NextResult = ItemSelectionDialogResult.Confirmed;
            var data = new ExternalCommandData
            {
                Application = new UIApplication { ActiveUIDocument = new UIDocument { Document = document } }
            };
            string message = null;
            var result = new ExportIfcCommand().Execute(data, ref message, new ElementSet());
            // The stub proves the exact API argument only; the resulting disk filename still needs a real Revit version check.
            Assert(result == Result.Succeeded && document.LastExportFolder == folder.TrimEnd(Path.DirectorySeparatorChar) && document.LastExportName == "lukas-stub.ifc" && !document.IsModifiable, "IFC export uses selected path inside a closed transaction");

            FileSaveDialog.NextResult = ItemSelectionDialogResult.Canceled;
            result = new ExportIfcCommand().Execute(data, ref message, new ElementSet());
            Assert(result == Result.Cancelled, "IFC export cancellation");
            if (File.Exists(Path.Combine(folder, "lukas-stub.ifc"))) File.Delete(Path.Combine(folder, "lukas-stub.ifc"));
        }

        private static void TestIfcQtoPackage(Document document)
        {
            string root = Path.Combine(Path.GetTempPath(), "lukas-package-stub-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            try
            {
                DateTime utc = new DateTime(2026, 8, 12, 1, 2, 3, DateTimeKind.Utc);
                string expectedFinal = Path.Combine(root, "sample_20260812_010203");
                string path;
                string error;
                Result result = ExportIfcQtoPackageCommand.CreatePackage(document, root, "sample", utc, "2026", out path, out error);
                Assert(result == Result.Succeeded && path == expectedFinal, "package succeeds at deterministic final path");
                Assert(Directory.Exists(expectedFinal) && !Directory.Exists(expectedFinal + ".partial"), "partial directory is atomically renamed");
                Assert(File.Exists(Path.Combine(expectedFinal, "model.ifc")) && File.Exists(Path.Combine(expectedFinal, "qto.csv")) && File.Exists(Path.Combine(expectedFinal, "element-ledger.csv")) && File.Exists(Path.Combine(expectedFinal, "export-manifest.csv")), "complete package has all four files");

                string manifest = File.ReadAllText(Path.Combine(expectedFinal, "export-manifest.csv"));
                string[] manifestHeader = Csv.Read(Path.Combine(expectedFinal, "export-manifest.csv"))[0];
                string[] manifestValues = Csv.Read(Path.Combine(expectedFinal, "export-manifest.csv"))[1];
                Assert(manifestHeader.Length == 16 && manifestValues.Length == 16 && manifestHeader[11] == "element_ledger_file" && manifestHeader[12] == "element_ledger_sha256" && manifestHeader[13] == "element_ledger_row_count", "manifest v2 has exact 16-field element ledger contract");
                Assert(manifestValues[1] == "2026-08-12T01:02:03.0000000Z" && manifestValues[2] == "2026" && manifestValues[3] == "stub", "manifest records UTC, Revit version, and document title");
                Assert(manifestValues[4].Contains("not user-selected") && manifestValues[5] == "model.ifc" && manifestValues[7] == "qto.csv", "manifest is honest about default IFC configuration and uses relative paths");
                Assert(manifestValues[9] == "1" && manifestValues[10] == "2" && manifestValues[11] == "element-ledger.csv" && manifestValues[13] == "2" && manifestValues[14] == "COMPLETE", "manifest records QTO and element-ledger counts");
                Assert(manifestValues[6] == Hash(Path.Combine(expectedFinal, "model.ifc")) && manifestValues[8] == Hash(Path.Combine(expectedFinal, "qto.csv")), "manifest hashes re-read exported files");
                Assert(manifestValues[12] == Hash(Path.Combine(expectedFinal, "element-ledger.csv")) && ElementQuantityLedger.Read(Path.Combine(expectedFinal, "element-ledger.csv")).Count == int.Parse(manifestValues[13]), "manifest binds strict element-ledger hash and row count");
                var packageElementRows = ElementQuantityLedger.Read(Path.Combine(expectedFinal, "element-ledger.csv"));
                Assert(packageElementRows.All(x => x.VolumeState == ElementVolumeState.COMPUTED) && packageElementRows.Sum(x => x.VolumeM3.Value) == 15m, "package element ledger preserves computed model rows");

                string expectedQtoHash = manifestValues[8];
                File.AppendAllText(Path.Combine(expectedFinal, "qto.csv"), "tampered");
                Assert(expectedQtoHash != Hash(Path.Combine(expectedFinal, "qto.csv")), "QTO tampering is detected by manifest hash");
                string expectedElementLedgerHash = manifestValues[12];
                File.AppendAllText(Path.Combine(expectedFinal, "element-ledger.csv"), "tampered");
                Assert(expectedElementLedgerHash != Hash(Path.Combine(expectedFinal, "element-ledger.csv")), "element-ledger tampering is detected by manifest hash");

                document.ExportResult = false;
                result = ExportIfcQtoPackageCommand.CreatePackage(document, root, "ifc-fail", utc, "2026", out path, out error);
                string ifcFailure = path;
                Assert(result == Result.Failed && Directory.Exists(ifcFailure) && !Directory.Exists(Path.Combine(root, "ifc-fail_20260812_010203")), "IFC failure preserves only partial evidence");
                Assert(File.ReadAllText(Path.Combine(ifcFailure, "export-manifest.csv")).Contains(",FAILED,"), "IFC failure writes FAILED manifest");
                document.ExportResult = true;

                document.ThrowOnElements = true;
                document.ElementsExceptionMessage = "=DANGEROUS()";
                result = ExportIfcQtoPackageCommand.CreatePackage(document, root, "qto-fail", utc, "2026", out path, out error);
                string qtoFailure = path;
                Assert(result == Result.Failed && File.Exists(Path.Combine(qtoFailure, "model.ifc")) && !Directory.Exists(Path.Combine(root, "qto-fail_20260812_010203")), "QTO failure keeps exported IFC in partial evidence");
                string failedManifest = File.ReadAllText(Path.Combine(qtoFailure, "export-manifest.csv"));
                Assert(failedManifest.Contains(",FAILED,") && failedManifest.Contains("'=DANGEROUS()"), "QTO failure manifest records and neutralizes the failure reason");
                document.ThrowOnElements = false;
                document.ElementsExceptionMessage = "stub QTO failure";

                var invalidVolumeDocument = new Document { Title = "invalid-volume" };
                ElementId invalidTypeId = Id(50);
                invalidVolumeDocument.Add(new ElementType { Id = invalidTypeId, FamilyName = "Wall", Name = "Concrete" });
                var invalidVolumeElement = new Element { Id = Id(501), TypeId = invalidTypeId, Category = new Category { Name = "Walls", CategoryType = CategoryType.Model }, Name = "Wall" };
                invalidVolumeElement.SetParameter(BuiltInParameter.HOST_VOLUME_COMPUTED, Number(-1));
                invalidVolumeDocument.Add(invalidVolumeElement);
                result = ExportIfcQtoPackageCommand.CreatePackage(invalidVolumeDocument, root, "ledger-fail", utc, "2026", out path, out error);
                string ledgerFailure = path;
                Assert(result == Result.Failed && Directory.Exists(ledgerFailure) && File.Exists(Path.Combine(ledgerFailure, "model.ifc")) && File.Exists(Path.Combine(ledgerFailure, "qto.csv")) && !Directory.Exists(Path.Combine(root, "ledger-fail_20260812_010203")), "invalid element ledger keeps only partial evidence and cannot publish COMPLETE");
                string[] ledgerFailureManifest = Csv.Read(Path.Combine(ledgerFailure, "export-manifest.csv"))[1];
                Assert(ledgerFailureManifest.Length == 16 && ledgerFailureManifest[14] == "FAILED" && ledgerFailureManifest[13] == "0", "element ledger failure writes v2 FAILED manifest with no claimed rows");

                var emptyDocument = new Document { Title = "=DANGEROUS()" };
                result = ExportIfcQtoPackageCommand.CreatePackage(emptyDocument, root, "empty", utc, "2026", out path, out error);
                string emptyFailure = path;
                string emptyManifest = File.ReadAllText(Path.Combine(emptyFailure, "export-manifest.csv"));
                Assert(result == Result.Failed && !Directory.Exists(Path.Combine(root, "empty_20260812_010203")), "empty QTO cannot become a COMPLETE package");
                Assert(emptyManifest.Contains("'=DANGEROUS()") && emptyManifest.Contains(",FAILED,") && emptyManifest.Contains("집계 대상이 없어"), "manifest neutralizes spreadsheet formulas and explains empty QTO failure");

                string collision = Path.Combine(root, "collision_20260812_010203");
                Directory.CreateDirectory(collision);
                File.WriteAllText(Path.Combine(collision, "sentinel"), "keep");
                result = ExportIfcQtoPackageCommand.CreatePackage(document, root, "collision", utc, "2026", out path, out error);
                Assert(result == Result.Failed && File.ReadAllText(Path.Combine(collision, "sentinel")) == "keep" && Directory.GetDirectories(root, "collision_*.partial").Length == 0, "final path collision is non-destructive");

                string foreignPartial = Path.Combine(root, "foreign_20260812_010203.partial");
                Directory.CreateDirectory(foreignPartial);
                File.WriteAllText(Path.Combine(foreignPartial, "sentinel"), "keep");
                result = ExportIfcQtoPackageCommand.CreatePackage(document, root, "foreign", utc, "2026", out path, out error);
                Assert(result == Result.Succeeded && File.ReadAllText(Path.Combine(foreignPartial, "sentinel")) == "keep", "package export never reuses or deletes another instance's staging folder");

                FileSaveDialog.NextPath = Path.Combine(root, "cancel.ifc");
                FileSaveDialog.NextResult = ItemSelectionDialogResult.Canceled;
                var data = new ExternalCommandData { Application = new UIApplication { ActiveUIDocument = new UIDocument { Document = document } } };
                string message = null;
                result = new ExportIfcQtoPackageCommand().Execute(data, ref message, new ElementSet());
                Assert(result == Result.Cancelled && Directory.GetDirectories(root, "cancel_*").Length == 0, "package cancellation creates no folder");
            }
            finally
            {
                Directory.Delete(root, true);
            }
        }

        private static string Hash(string path)
        {
            using (var stream = File.OpenRead(path))
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
        }
    }
}
