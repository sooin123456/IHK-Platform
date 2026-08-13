using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using THEKIE.Qto.Core;

namespace THEKIE.Qto.Core.SelfTest
{
    internal static class Program
    {
        private static int Main()
        {
            try
            {
                var qto = new QtoRecord { Category = "Walls", Family = "Basic Wall", Type = "Concrete", Level = "L1", Count = 1m, AreaM2 = 12.5m };
                qto.Id = Input.ComputeQtoAuditKey(qto.Category, qto.Family, qto.Type, qto.Level);
                qto.ElementIds.Add("1001");
                var line = new EstimateLine { Id = "BOQ-01", Unit = "m2", Quantity = 12.5m, UnitPriceKrw = 12000m, AmountKrw = 150000m };
                var findings = Preflight.Run(new[] { qto }, new[] { line }, new[] { new Mapping { EstimateLineId = "BOQ-01", QtoId = qto.Id, Unit = "m2", Multiplier = 1m } }, new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R011" && x.Status == "PASS"), "amount pass");
                Assert(findings.Any(x => x.Rule == "R021" && x.Status == "PASS"), "BIM quantity pass");

                var emsLine = new EstimateLine { Id = "EMS-01", Unit = "m2", Quantity = 1.5m, MaterialUnitPriceKrw = 1m, LaborUnitPriceKrw = 1m, ExpenseUnitPriceKrw = 1m, UnitPriceKrw = 3m, AmountKrw = 3m, UseComponentTruncation = true };
                findings = Preflight.Run(new QtoRecord[0], new[] { emsLine }, new Mapping[0], new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R010" && x.Status == "PASS") && findings.Any(x => x.Rule == "R011" && x.Status == "PASS"), "EMS component prices and truncation");
                emsLine.UnitPriceKrw = 2m;
                findings = Preflight.Run(new QtoRecord[0], new[] { emsLine }, new Mapping[0], new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R010" && x.Status == "FAIL"), "EMS total unit price mismatch");

                var incompleteEmsLine = new EstimateLine { Id = "EMS-INCOMPLETE", Unit = "m2", Quantity = 1.5m, MaterialUnitPriceKrw = 1m, LaborUnitPriceKrw = 1m, UnitPriceKrw = 3m, AmountKrw = 5m, UseComponentTruncation = true };
                findings = Preflight.Run(new QtoRecord[0], new[] { incompleteEmsLine }, new Mapping[0], new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R010" && x.Status == "NOT_EVALUATED") && findings.Any(x => x.Rule == "R011" && x.Status == "NOT_EVALUATED") && !findings.Any(x => x.Rule == "R011" && x.Status == "PASS"), "incomplete EMS components cannot pass through general formula");
                var offsettingComponentError = new EstimateLine { Id = "EMS-OFFSET", Unit = "m2", Quantity = 1m, MaterialUnitPriceKrw = 1m, LaborUnitPriceKrw = 1m, ExpenseUnitPriceKrw = 0m, MaterialAmountKrw = 2m, LaborAmountKrw = 0m, ExpenseAmountKrw = 0m, UnitPriceKrw = 2m, AmountKrw = 2m, UseComponentTruncation = true };
                findings = Preflight.Run(new QtoRecord[0], new[] { offsettingComponentError }, new Mapping[0], new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R011" && x.Status == "FAIL"), "offsetting EMS component errors cannot pass by total alone");
                var partialComponent = new EstimateLine { Id = "EMS-PARTIAL", Unit = "m2", Quantity = 1m, MaterialUnitPriceKrw = 1m, LaborUnitPriceKrw = 1m, ExpenseUnitPriceKrw = 1m, MaterialAmountKrw = 1m, UnitPriceKrw = 3m, AmountKrw = 3m, UseComponentTruncation = true };
                findings = Preflight.Run(new QtoRecord[0], new[] { partialComponent }, new Mapping[0], new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R011" && x.Status == "PASS"), "provided EMS component amounts are checked without requiring all source amounts");

                var adjustment = new EstimateLine { Id = "EMS-ADJ", Unit = "KG", Quantity = -52m, MaterialUnitPriceKrw = 300m, LaborUnitPriceKrw = 0m, ExpenseUnitPriceKrw = 0m, UnitPriceKrw = 300m, AmountKrw = -15600m, UseComponentTruncation = true, IsAdjustment = true, IsEmsSource = true };
                findings = Preflight.Run(new QtoRecord[0], new[] { adjustment }, new[] { new Mapping { EstimateLineId = adjustment.Id, QtoId = "MISSING", Unit = "KG", Multiplier = 0m } }, new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R011" && x.Status == "PASS") && !findings.Any(x => x.Rule == "R030") && findings.Any(x => x.Rule == "R020" && x.Status == "FAIL") && findings.Any(x => x.Rule == "R021" && x.Status == "NOT_EVALUATED"), "EMS negative adjustment still validates invalid mapping");
                var fakeAdjustment = new EstimateLine { Id = "CSV-ADJ", Unit = "m2", Quantity = -1m, UnitPriceKrw = 100m, AmountKrw = -100m, IsAdjustment = true };
                findings = Preflight.Run(new QtoRecord[0], new[] { fakeAdjustment }, new Mapping[0], new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R030" && x.Status == "FAIL") && findings.Any(x => x.Rule == "R011" && x.Status == "NOT_EVALUATED"), "caller flag cannot forge EMS adjustment");
                fakeAdjustment.UseComponentTruncation = true; fakeAdjustment.MaterialUnitPriceKrw = 100m; fakeAdjustment.LaborUnitPriceKrw = 0m; fakeAdjustment.ExpenseUnitPriceKrw = 0m;
                findings = Preflight.Run(new QtoRecord[0], new[] { fakeAdjustment }, new Mapping[0], new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R030" && x.Status == "FAIL"), "caller cannot forge EMS provenance with both public flags");

                var totalLine = new EstimateLine { Id = "EMS-TOTAL", Unit = "m2", Quantity = 1m, MaterialUnitPriceKrw = 10000m, LaborUnitPriceKrw = 20000m, ExpenseUnitPriceKrw = 30000m, MaterialAmountKrw = 10000m, LaborAmountKrw = 20000m, ExpenseAmountKrw = 30000m, UnitPriceKrw = 60000m, AmountKrw = 60000m, UseComponentTruncation = true };
                var summary = new EstimateSummary { MaterialSubtotal = 10000m, IndirectLabor = 2000m, LaborSubtotal = 22000m, ExpenseAdditions = 3000m, ExpenseSubtotal = 33000m, DirectCost = 65000m, GeneralAdmin = 6000m, Profit = 9000m, SupplyAmount = 80000m, Vat = 8000m, ContractAmount = 88000m, TotalAmount = 88000m };
                foreach (string code in new[] { "AS", "B2", "BS", "C4", "C5", "C6", "C7", "CA", "CB", "CG", "CH", "CS", "S1", "D1", "D2", "D9", "DB", "DH", "S2" }) summary.SourceRows[code] = summary.SourceRows.Count + 1;
                findings = Preflight.Run(new QtoRecord[0], new[] { totalLine }, new Mapping[0], new AuditPolicy(), summary);
                Assert(findings.Count(x => x.Rule == "R012" && x.Status == "PASS") == 8, "EMS summary arithmetic");
                Assert(findings.Any(x => x.Rule == "R012" && x.LineId == "SUMMARY-AS" && x.Evidence.Contains("input-detail-rows=")) && findings.Any(x => x.Rule == "R012" && x.LineId == "SUMMARY-D9" && x.Evidence.Contains("input-summary-rows=S1:")), "EMS summary input provenance");
                summary.TotalAmount = 87000m;
                findings = Preflight.Run(new QtoRecord[0], new[] { totalLine }, new Mapping[0], new AuditPolicy(), summary);
                Assert(findings.Any(x => x.Rule == "R012" && x.LineId == "SUMMARY-S2" && x.Status == "FAIL"), "EMS summary mismatch");
                summary.SupplyAdditions = 5000m; summary.SupplyAmount = 80000m; summary.Vat = 8000m; summary.ContractAmount = 88000m; summary.FinalAdditions = 10000m; summary.TotalAmount = 98000m;
                summary.HasFinalAdditions = true;
                summary.SourceRows["D7"] = 20; summary.SourceRows["DK"] = 21;
                findings = Preflight.Run(new QtoRecord[0], new[] { totalLine }, new Mapping[0], new AuditPolicy(), summary);
                Assert(findings.Count(x => x.Rule == "R012" && x.Status == "PASS") == 8, "matching EMS subtotals remain verifiable with separate additions");
                summary.MaterialSubtotal = 9000m; summary.FinalAdditions = 0m; summary.HasFinalAdditions = true;
                findings = Preflight.Run(new QtoRecord[0], new[] { totalLine }, new Mapping[0], new AuditPolicy(), summary);
                Assert(findings.Any(x => x.LineId == "SUMMARY-AS" && x.Status == "NOT_EVALUATED"), "final addition presence survives cancellation");
                var incompleteSummaryLine = new EstimateLine { Id = "EMS-SUMMARY-INCOMPLETE", Unit = "m2", UseComponentTruncation = true };
                var internalSummary = new EstimateSummary { MaterialSubtotal = 10000m, IndirectLabor = 2000m, LaborSubtotal = 22000m, ExpenseAdditions = 3000m, ExpenseSubtotal = 33000m, DirectCost = 65000m, GeneralAdmin = 6000m, Profit = 9000m, SupplyAmount = 80000m, Vat = 8000m, ContractAmount = 88000m, TotalAmount = 88000m };
                findings = Preflight.Run(new QtoRecord[0], new[] { incompleteSummaryLine }, new Mapping[0], new AuditPolicy(), internalSummary);
                Assert(findings.Count(x => x.Rule == "R012" && x.Status == "NOT_EVALUATED") == 3 && findings.Count(x => x.Rule == "R012" && x.Status == "PASS") == 5, "incomplete detail does not suppress independent summary chain");

                line.AmountKrw = 149000m;
                findings = Preflight.Run(new[] { qto }, new[] { line }, new[] { new Mapping { EstimateLineId = "BOQ-01", QtoId = qto.Id, Unit = "m2", Multiplier = 1m } }, new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R011" && x.Status == "FAIL"), "amount fail");

                qto.ElementIds.Clear();
                findings = Preflight.Run(new[] { qto }, new[] { line }, new[] { new Mapping { EstimateLineId = "BOQ-01", QtoId = qto.Id, Unit = "m2", Multiplier = 1m } }, new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R020" && x.Status == "FAIL"), "traceability fail");

                qto.ElementIds.Add("1001");
                findings = Preflight.Run(new[] { qto }, new[] { line }, new Mapping[0], new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R021" && x.Status == "NOT_EVALUATED"), "missing mapping quantity status");

                line.Quantity = null;
                findings = Preflight.Run(new[] { qto }, new[] { line }, new[] { new Mapping { EstimateLineId = "BOQ-01", QtoId = qto.Id, Unit = "m2", Multiplier = 0m } }, new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R020" && x.Status == "FAIL"), "invalid mapping before missing quantity");

                line.Quantity = 12.5m;
                var unused = new QtoRecord { Category = "Floors", Family = "Floor", Type = "Concrete", Level = "L1", Count = 1m, AreaM2 = 10m };
                unused.Id = Input.ComputeQtoAuditKey(unused.Category, unused.Family, unused.Type, unused.Level);
                unused.ElementIds.Add("2001");
                findings = Preflight.Run(new[] { qto, unused }, new[] { line }, new[] { new Mapping { EstimateLineId = "BOQ-01", QtoId = qto.Id, Unit = "m2", Multiplier = 1m } }, new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R022" && x.QtoId == unused.Id), "unmapped BIM quantity review");

                var line2 = new EstimateLine { Id = "BOQ-02", Unit = "m2", Quantity = 12.5m, UnitPriceKrw = 12000m, AmountKrw = 150000m };
                findings = Preflight.Run(new[] { qto }, new[] { line, line2 }, new[] { new Mapping { EstimateLineId = "BOQ-01", QtoId = qto.Id, Unit = "m2", Multiplier = 1m }, new Mapping { EstimateLineId = "BOQ-02", QtoId = qto.Id, Unit = "m2", Multiplier = 1m } }, new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R023" && x.QtoId == qto.Id), "multiple mapping review");

                line.Quantity = -12.5m;
                line.AmountKrw = -150000m;
                findings = Preflight.Run(new[] { qto }, new[] { line }, new[] { new Mapping { EstimateLineId = "BOQ-01", QtoId = qto.Id, Unit = "m2", Multiplier = 1m } }, new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R030" && x.Status == "FAIL") && findings.Any(x => x.Rule == "R011" && x.Status == "NOT_EVALUATED") && findings.Any(x => x.Rule == "R021" && x.Status == "NOT_EVALUATED"), "negative estimate values rejected");

                line.Quantity = 12.5m;
                line.AmountKrw = 150000m;
                qto.AreaM2 = -12.5m;
                findings = Preflight.Run(new[] { qto }, new[] { line }, new[] { new Mapping { EstimateLineId = "BOQ-01", QtoId = qto.Id, Unit = "m2", Multiplier = 1m } }, new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R030" && x.QtoId == qto.Id) && findings.Any(x => x.Rule == "R020" && x.Status == "FAIL"), "negative QTO values rejected");
                qto.AreaM2 = 12.5m;

                TestQtoTraceabilityInput();
                TestPublicQtoCrossRowTraceability();
                TestPreflightBoundaryInputs();

                findings = Preflight.Run(new[] { qto }, new[] { line }, new[] { new Mapping { EstimateLineId = "BOQ-01", QtoId = qto.Id, Unit = "m2", Multiplier = 1m }, new Mapping { EstimateLineId = "BOQ-01", QtoId = qto.Id, Unit = "m2", Multiplier = 1m } }, new AuditPolicy());
                Assert(findings.Any(x => x.Rule == "R020" && x.Status == "FAIL") && findings.Any(x => x.Rule == "R021" && x.Status == "NOT_EVALUATED") && findings.Any(x => x.Rule == "R022"), "duplicate mapping rejected");

                TestXlsx();
                TestEmsXlsx();
                TestEmsInvalidNumberXlsx();
                TestEmsSummaryXlsx();
                TestCsv();
                TestMappingTemplate();
                TestFormulaProvenance();
                TestSourceGate();
                TestElementQuantityLedger();
                TestRevitExportPackage();
                TestRevitConcreteMapping();
                TestStructuralQuantity();
                TestRebarTakeoff();
                TestConcreteTakeoff();
                TestTakeoffReport();
                TestFormworkTakeoff();
                TestFormworkFaceLedgerCsv();
                TestRunManifest();
                TestHtmlReport();
                TestReportPrecision();
                TestInvariantNumbers();
                Console.WriteLine("Self-test passed.");
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.Message);
                return 1;
            }
        }

        private static void Assert(bool condition, string name)
        {
            if (!condition) throw new InvalidOperationException("Self-test failed: " + name);
        }

        private static void TestRebarTakeoff()
        {
            var h10Length = StructuralEvidence("SYNTHETIC-RAW", "FT", "H10", 'a');
            var h13Length = StructuralEvidence("SYNTHETIC-RAW", "FT", "H11", 'a');
            var unitMass = StructuralEvidence("SYNTHETIC-RULE", "unit", "B2", 'b');
            var loss = StructuralEvidence("SYNTHETIC-RULE", "loss", "B3", 'b');
            var rounding = StructuralEvidence("SYNTHETIC-RULE", "round", "B4", 'b');
            var officialSource = StructuralEvidence("SYNTHETIC-OFFICIAL", "summary", "C24", 'c');
            var bundle = new RebarRuleBundle {
                BundleId = "SYNTHETIC-REBAR-V1", Version = "1", Evidence = StructuralRule("SYNTHETIC-REBAR-V1", 'd')
            };
            var h10 = new RebarSpecificationRule {
                Spec = "H10", UnitMassKgPerM = 0.5m, UnitMassSource = unitMass, LossRate = 0.1m, LossSource = loss,
                RoundingStage = RebarRoundingStage.Specification, RoundingMode = StructuralRoundingMode.HalfUp, RoundingScale = 3, RoundingSource = rounding
            };
            var h13 = new RebarSpecificationRule {
                Spec = "H13", UnitMassKgPerM = 1m, UnitMassSource = StructuralEvidence("SYNTHETIC-RULE", "unit", "B5", 'b'), LossRate = 0m,
                LossSource = StructuralEvidence("SYNTHETIC-RULE", "loss", "B6", 'b'), RoundingStage = RebarRoundingStage.Specification,
                RoundingMode = StructuralRoundingMode.None, RoundingScale = 0, RoundingSource = StructuralEvidence("SYNTHETIC-RULE", "round", "B7", 'b')
            };
            bundle.Specifications.Add(h10); bundle.Specifications.Add(h13);
            bundle.Evidence.Sha256 = RebarTakeoff.ComputeRuleHash(bundle);
            var rows = new[] {
                new RebarLengthRow { RowId = "RAW-H10", Spec = "H10", SignedLengthM = 10m, Source = h10Length, IncludedComponents = RebarLengthComponent.Anchorage },
                new RebarLengthRow { RowId = "RAW-H13", Spec = "H13", SignedLengthM = 2m, Source = h13Length }
            };
            var official = new RebarOfficialTarget { MassKg = 7.5m, Source = officialSource };
            Assert(RebarTakeoff.Evaluate(rows, bundle, official, 0m, null).Status == StructuralQuantityStatus.REVIEW,
                "per-spec rebar calculation needs an approved registry");
            var registry = new StructuralEvidenceRegistry();
            registry.ApprovedRuleHashes[bundle.Evidence.RuleId] = bundle.Evidence.Sha256;
            foreach (StructuralSourceEvidence source in new[] { h10Length, h13Length, unitMass, loss, rounding, h13.UnitMassSource, h13.LossSource, h13.RoundingSource, officialSource })
                registry.ApprovedSourceHashes[source.SourceId] = source.Sha256;
            RebarTakeoffResult takeoff = RebarTakeoff.Evaluate(rows, bundle, official, 0m, registry);
            Assert(takeoff.Status == StructuralQuantityStatus.PASS && takeoff.CalculatedMassKg == 7.5m && takeoff.Specifications.Count == 2,
                "approved per-spec rebar calculation reconciles an independent target");
            Assert(RebarTakeoff.Evaluate(rows, bundle, new RebarOfficialTarget { MassKg = 100m, Source = officialSource }, 100m, registry).Status == StructuralQuantityStatus.REVIEW,
                "caller cannot widen the approved rebar tolerance");

            h10.AdditionalLengths.Add(new RebarAdditionalLengthRule { RuleId = "DOUBLE-ANCHOR", Component = RebarLengthComponent.Anchorage, SignedLengthM = 1m, Source = StructuralEvidence("SYNTHETIC-RULE", "add", "B8", 'b') });
            bundle.Evidence.Sha256 = RebarTakeoff.ComputeRuleHash(bundle);
            Assert(RebarTakeoff.Evaluate(rows, bundle, official, 0m, registry).Status == StructuralQuantityStatus.REVIEW,
                "anchorage already present in raw length cannot be added again");
            h10.AdditionalLengths.Clear();
            bundle.Evidence.Sha256 = RebarTakeoff.ComputeRuleHash(bundle);
            registry.ApprovedRuleHashes[bundle.Evidence.RuleId] = bundle.Evidence.Sha256;
            Assert(RebarTakeoff.Evaluate(rows, bundle, new RebarOfficialTarget { MassKg = 7.5m, Source = h10Length }, 0m, registry).Status == StructuralQuantityStatus.REVIEW,
                "official target cannot reuse a raw length source cell");
            Assert(RebarTakeoff.Evaluate(rows, bundle, null, 0m, registry).Status == StructuralQuantityStatus.NOT_EVALUATED,
                "rebar calculation without an independent official target is not evaluated");
            Assert(RebarTakeoff.Evaluate(rows.Concat(new[] { new RebarLengthRow { RowId = "RAW-H22", Spec = "H22", SignedLengthM = 1m, Source = StructuralEvidence("SYNTHETIC-RAW", "FT", "H12", 'a') } }), bundle, official, 0m, registry).Status == StructuralQuantityStatus.FAIL,
                "selected unsupported rebar specification fails instead of guessing a unit mass");
            decimal approvedUnitMass = h10.UnitMassKgPerM;
            h10.UnitMassKgPerM = 0.6m;
            Assert(RebarTakeoff.Evaluate(rows, bundle, official, 0m, registry).Status == StructuralQuantityStatus.REVIEW,
                "changed rebar rule content cannot reuse an approved bundle hash");
            h10.UnitMassKgPerM = approvedUnitMass;

            string reportDirectory = Path.Combine(Path.GetTempPath(), "thekie-rebar-report-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(reportDirectory);
            try
            {
                var inputs = new Dictionary<string, string> { ["length_ledger"] = new string('1', 64), ["rule_bundle"] = new string('2', 64),
                    ["registry"] = new string('3', 64), ["official_target"] = new string('4', 64) };
                string report = Path.Combine(reportDirectory, "rebar.csv");
                TakeoffReportArtifact artifact = RebarTakeoffReport.Write(report, takeoff, inputs);
                Assert(RebarTakeoffReport.Verify(report).ReportSha256 == artifact.ReportSha256, "strict rebar report round-trip verifies");

                List<string[]> missingOfficialManifest = Csv.Read(report + ".manifest.csv");
                missingOfficialManifest.RemoveAll(row => row[0] == "input_official_target");
                Csv.Write(report + ".manifest.csv", missingOfficialManifest);
                bool rejected = false; try { RebarTakeoffReport.Verify(report); } catch (InvalidDataException) { rejected = true; }
                Assert(rejected, "rebar verifier rejects PASS when official target provenance is removed");

                string missingOfficial = Path.Combine(reportDirectory, "missing-official.csv");
                rejected = false;
                try { RebarTakeoffReport.Write(missingOfficial, takeoff, inputs.Where(pair => pair.Key != "official_target").ToDictionary(pair => pair.Key, pair => pair.Value)); }
                catch (InvalidDataException) { rejected = true; }
                Assert(rejected && !File.Exists(missingOfficial) && !File.Exists(missingOfficial + ".manifest.csv"), "PASS rebar report requires official target provenance before publishing");

                string malformed = Path.Combine(reportDirectory, "malformed.csv");
                RebarTakeoffReport.Write(malformed, takeoff, inputs);
                List<string[]> malformedRows = Csv.Read(malformed); malformedRows[0][0] = "anything"; Csv.Write(malformed, malformedRows);
                List<string[]> malformedManifest = Csv.Read(malformed + ".manifest.csv");
                malformedManifest.Single(row => row[0] == "report_sha256")[1] = RunManifest.Hash(malformed); Csv.Write(malformed + ".manifest.csv", malformedManifest);
                rejected = false; try { RebarTakeoffReport.Verify(malformed); } catch (InvalidDataException) { rejected = true; }
                Assert(rejected, "rebar verifier rejects a hash-bound report with a forged header");

                string wrongDelta = Path.Combine(reportDirectory, "wrong-delta.csv");
                RebarTakeoffReport.Write(wrongDelta, takeoff, inputs);
                List<string[]> deltaRows = Csv.Read(wrongDelta); deltaRows[1][8] = "delta_kg=1"; Csv.Write(wrongDelta, deltaRows);
                List<string[]> deltaManifest = Csv.Read(wrongDelta + ".manifest.csv");
                deltaManifest.Single(row => row[0] == "report_sha256")[1] = RunManifest.Hash(wrongDelta); Csv.Write(wrongDelta + ".manifest.csv", deltaManifest);
                rejected = false; try { RebarTakeoffReport.Verify(wrongDelta); } catch (InvalidDataException) { rejected = true; }
                Assert(rejected, "rebar verifier recomputes summary delta instead of trusting a hash-bound value");

                string collision = Path.Combine(reportDirectory, "collision.csv");
                File.WriteAllText(collision, "foreign");
                rejected = false; try { RebarTakeoffReport.Write(collision, takeoff, inputs); } catch (IOException) { rejected = true; }
                Assert(rejected && File.ReadAllText(collision) == "foreign", "rebar report collision never deletes a foreign destination");
            }
            finally { Directory.Delete(reportDirectory, true); }
        }

        private static void TestElementQuantityLedger()
        {
            string directory = Path.Combine(Path.GetTempPath(), "thekie-element-ledger-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            try
            {
                var source = new[] {
                    new ElementQuantityLedgerRow { ElementId = " 00042 ", Category = "=Walls", Family = "  @Family", Type = "'Type", ElementName = "-Wall instance", Level = "+L1", VolumeState = ElementVolumeState.COMPUTED, VolumeM3 = 12345678901234567890.12345678m, SourceParameter = "HOST_VOLUME_COMPUTED", LengthState = ElementVolumeState.COMPUTED, LengthM = 12.5m, LengthSourceParameter = "CURVE_ELEM_LENGTH", HeightState = ElementVolumeState.ZERO, HeightM = 0m, HeightSourceParameter = "WALL_USER_HEIGHT_PARAM" },
                    new ElementQuantityLedgerRow { ElementId = "43", Category = "Floors", Family = "Floor", Type = "Zero", ElementName = "Floor instance", Level = "L1", VolumeState = ElementVolumeState.ZERO, VolumeM3 = 0m, SourceParameter = "PROPERTY_VOLUME_PARAM" },
                    new ElementQuantityLedgerRow { ElementId = "44", Category = "Walls", Family = "", Type = "", Level = "", VolumeState = ElementVolumeState.MISSING, VolumeM3 = null, SourceParameter = "" }
                };
                string path = Path.Combine(directory, "ledger.csv");
                ElementQuantityLedger.Write(path, source);
                IReadOnlyList<ElementQuantityLedgerRow> rows = ElementQuantityLedger.Read(path);
                Assert(rows.Count == 3 && rows[0].ElementId == "42" && rows[0].Category == "=Walls" && rows[0].Family == "  @Family" && rows[0].Type == "'Type" && rows[0].ElementName == "-Wall instance" && rows[0].Level == "+L1" &&
                    rows[0].VolumeState == ElementVolumeState.COMPUTED && rows[0].VolumeM3 == 12345678901234567890.12345678m && rows[0].SourceParameter == "HOST_VOLUME_COMPUTED" &&
                    rows[0].LengthState == ElementVolumeState.COMPUTED && rows[0].LengthM == 12.5m && rows[0].LengthSourceParameter == "CURVE_ELEM_LENGTH" &&
                    rows[0].HeightState == ElementVolumeState.ZERO && rows[0].HeightM == 0m && rows[0].HeightSourceParameter == "WALL_USER_HEIGHT_PARAM" &&
                    rows[1].VolumeState == ElementVolumeState.ZERO && rows[1].VolumeM3 == 0m && rows[1].LengthState == ElementVolumeState.MISSING && !rows[1].LengthM.HasValue &&
                    rows[2].VolumeState == ElementVolumeState.MISSING && !rows[2].VolumeM3.HasValue && rows[2].HeightState == ElementVolumeState.MISSING && !rows[2].HeightM.HasValue,
                    "element ledger exact round-trip preserves states, decimal, and raw metadata");
                string[] raw = Csv.Read(path)[1];
                Assert(raw.Length == 15 && raw[1] == "'=Walls" && raw[2] == "  '@Family" && raw[3] == "''Type" && raw[4] == "'-Wall instance" && raw[5] == "'+L1", "element ledger neutralizes spreadsheet formulas reversibly");

                bool rejected = false;
                try { ElementQuantityLedger.Write(Path.Combine(directory, "duplicate.csv"), new[] { source[0], new ElementQuantityLedgerRow { ElementId = "42", VolumeState = ElementVolumeState.MISSING } }); }
                catch (InvalidDataException) { rejected = true; }
                Assert(rejected, "element ledger rejects duplicate IDs after canonicalization");
                rejected = false;
                try { ElementQuantityLedger.CanonicalElementId("=42"); } catch (InvalidDataException) { rejected = true; }
                Assert(rejected, "element ledger rejects non-decimal IDs");

                string duplicateInput = Path.Combine(directory, "duplicate-input.csv");
                Csv.Write(duplicateInput, new[] {
                    new[] { "element_id", "category", "family", "type", "element_name", "level", "volume_state", "volume_m3", "volume_source_parameter", "length_state", "length_m", "length_source_parameter", "height_state", "height_m", "height_source_parameter" },
                    new[] { "7", "", "", "", "", "", "MISSING", "", "", "MISSING", "", "", "MISSING", "", "" },
                    new[] { "007", "", "", "", "", "", "MISSING", "", "", "MISSING", "", "", "MISSING", "", "" }
                });
                rejected = false;
                try { ElementQuantityLedger.Read(duplicateInput); } catch (InvalidDataException) { rejected = true; }
                Assert(rejected, "element ledger reader rejects global duplicate IDs");
            }
            finally { Directory.Delete(directory, true); }
        }

        private static void TestRevitExportPackage()
        {
            string directory = Path.Combine(Path.GetTempPath(), "thekie-export-package-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            try
            {
                string ifc = Path.Combine(directory, "model.ifc");
                string qto = Path.Combine(directory, "qto.csv");
                string ledger = Path.Combine(directory, "element-ledger.csv");
                string manifest = Path.Combine(directory, "export-manifest.csv");
                File.WriteAllText(ifc, "ISO-10303-21;\nEND-ISO-10303-21;\n");
                string auditKey = Input.ComputeQtoAuditKey("Walls", "Basic Wall", "W300", "1F");
                Csv.Write(qto, new[] {
                    new[] { "검산키", "분류", "패밀리", "타입", "레벨", "수량", "체적_m3", "면적_m2", "길이_m", "요소ID" },
                    new[] { auditKey, "Walls", "Basic Wall", "W300", "1F", "1", "4", "0", "0", "101" }
                });
                ElementQuantityLedger.Write(ledger, new[] { new ElementQuantityLedgerRow {
                    ElementId = "101", Category = "Walls", Family = "Basic Wall", Type = "W300", Level = "1F",
                    VolumeState = ElementVolumeState.COMPUTED, VolumeM3 = 4m, SourceParameter = "HOST_VOLUME_COMPUTED"
                }});
                Csv.Write(manifest, new[] {
                    new[] { "product_version", "exported_at_utc", "revit_version", "document_title", "ifc_configuration", "ifc_file", "ifc_sha256", "qto_file", "qto_sha256", "qto_row_count", "element_count", "element_ledger_file", "element_ledger_sha256", "element_ledger_row_count", "status", "failure_reason" },
                    new[] { "2", "2026-08-13T00:00:00Z", "2026", "test", "default", "model.ifc", RunManifest.Hash(ifc), "qto.csv", RunManifest.Hash(qto), "1", "1", "element-ledger.csv", RunManifest.Hash(ledger), "1", "COMPLETE", "" }
                });
                RevitExportPackageResult verified = RevitExportPackage.Verify(manifest);
                Assert(verified.ElementCount == 1 && verified.QtoRowCount == 1 && verified.ElementLedgerRowCount == 1 &&
                    verified.ElementLedgerSha256 == RunManifest.Hash(ledger), "Revit export package binds IFC, QTO, and element ledger");

                File.AppendAllText(ledger, Environment.NewLine);
                bool rejected = false;
                try { RevitExportPackage.Verify(manifest); } catch (InvalidDataException) { rejected = true; }
                Assert(rejected, "tampered element ledger cannot enter takeoff evaluation");
            }
            finally { Directory.Delete(directory, true); }
        }

        private static void TestRevitConcreteMapping()
        {
            var bundle = new RevitConcreteMappingBundle { BundleId = "REVIT-CONCRETE", Version = "1", SourceRef = "approved-revit-map.csv!A1:F2" };
            bundle.Rules.Add(new RevitConcreteMappingRule { Category = "Structural Walls", Family = "Concrete Wall", Type = "W300", Building = "A", Member = "Wall", Spec = "25-270-15" });
            bundle.Sha256 = ConcreteTakeoff.ComputeRevitMappingHash(bundle);
            var registry = new ConcreteRuleRegistry();
            registry.ApprovedRevitMappingHashes[ConcreteRuleRegistry.BundleKey(bundle.BundleId, bundle.Version)] = bundle.Sha256;
            var rows = new[] {
                new ElementQuantityLedgerRow { ElementId = "101", Category = "Structural Walls", Family = "Concrete Wall", Type = "W300", Level = "1F", VolumeState = ElementVolumeState.COMPUTED, VolumeM3 = 4m, SourceParameter = "HOST_VOLUME_COMPUTED" },
                new ElementQuantityLedgerRow { ElementId = "102", Category = "Structural Walls", Family = "Concrete Wall", Type = "W300", Level = "1F", VolumeState = ElementVolumeState.ZERO, VolumeM3 = 0m, SourceParameter = "HOST_VOLUME_COMPUTED" }
            };
            RevitConcreteMappingResult mapped = ConcreteTakeoff.MapRevitLedger(rows, bundle, registry);
            ConcreteInputRow output = mapped.Rows.Single();
            Assert(mapped.Status == StructuralQuantityStatus.PASS && mapped.ComputedSelectedCount == 1 && mapped.ZeroExcludedCount == 1 && mapped.MissingReviewCount == 0 && mapped.UnmatchedReviewCount == 0 &&
                output.RowId == "revit/101" && output.SourceKind == ConcreteSourceKind.Revit && output.Floor == "1F" && output.Building == "A" && output.Member == "Wall" && output.Spec == "25-270-15" && output.ElementIds.SequenceEqual(new[] { "101" }) && output.Operation == StructuralQuantityOperation.Normal,
                "approved exact Revit mapping creates stable, element-provenance concrete input only for COMPUTED volume");
            mapped = ConcreteTakeoff.MapRevitLedger(rows.Concat(new[] { new ElementQuantityLedgerRow { ElementId = "103", Category = "Structural Walls", Family = "Concrete Wall", Type = "W300", Level = "1F", VolumeState = ElementVolumeState.MISSING } }), bundle, registry);
            Assert(mapped.Status == StructuralQuantityStatus.REVIEW && mapped.MissingReviewCount == 1 && mapped.Rows.Count == 1, "MISSING Revit volume is preserved as a review count, not mapped as zero");
            mapped = ConcreteTakeoff.MapRevitLedger(rows.Concat(new[] { new ElementQuantityLedgerRow { ElementId = "104", Category = "Floors", Family = "Concrete Floor", Type = "F200", Level = "1F", VolumeState = ElementVolumeState.COMPUTED, VolumeM3 = 2m, SourceParameter = "HOST_VOLUME_COMPUTED" } }), bundle, registry);
            Assert(mapped.Status == StructuralQuantityStatus.REVIEW && mapped.UnmatchedReviewCount == 1 && mapped.Rows.Count == 1, "unmatched computed Revit element is a review instead of a guessed mapping");
            bundle.Rules.Add(new RevitConcreteMappingRule { Category = "Generic Models", Family = "Furniture", Type = "Chair", Decision = RevitConcreteMappingDecision.Exclude });
            bundle.Sha256 = ConcreteTakeoff.ComputeRevitMappingHash(bundle);
            registry.ApprovedRevitMappingHashes[ConcreteRuleRegistry.BundleKey(bundle.BundleId, bundle.Version)] = bundle.Sha256;
            mapped = ConcreteTakeoff.MapRevitLedger(rows.Concat(new[] { new ElementQuantityLedgerRow { ElementId = "105", Category = "Generic Models", Family = "Furniture", Type = "Chair", Level = "1F", VolumeState = ElementVolumeState.COMPUTED, VolumeM3 = 2m, SourceParameter = "HOST_VOLUME_COMPUTED" } }), bundle, registry);
            Assert(mapped.Status == StructuralQuantityStatus.PASS && mapped.ComputedExcludedCount == 1 && mapped.Rows.Count == 1,
                "approved exact EXCLUDE decision removes a non-concrete computed element without guessing");
            bundle.Rules.RemoveAt(bundle.Rules.Count - 1);
            bundle.Sha256 = ConcreteTakeoff.ComputeRevitMappingHash(bundle);
            registry.ApprovedRevitMappingHashes[ConcreteRuleRegistry.BundleKey(bundle.BundleId, bundle.Version)] = bundle.Sha256;
            var duplicate = new RevitConcreteMappingBundle { BundleId = "DUP", Version = "1", SourceRef = "map" };
            duplicate.Rules.Add(bundle.Rules[0]); duplicate.Rules.Add(new RevitConcreteMappingRule { Category = "Structural Walls", Family = "Concrete Wall", Type = "W300", Building = "B", Member = "Wall", Spec = "25-270-15" });
            duplicate.Sha256 = ConcreteTakeoff.ComputeRevitMappingHash(duplicate);
            Assert(ConcreteTakeoff.MapRevitLedger(rows, duplicate, registry).Status == StructuralQuantityStatus.FAIL, "duplicate exact Revit mapping rules fail");
            string approvedHash = bundle.Sha256;
            bundle.Rules[0].Spec = "25-180-8";
            Assert(ConcreteTakeoff.MapRevitLedger(rows, bundle, registry).Status == StructuralQuantityStatus.FAIL, "tampered mapping bundle cannot retain a canonical hash");
            bundle.Rules[0].Spec = "25-270-15"; bundle.Sha256 = approvedHash;
            var empty = new RevitConcreteMappingBundle { BundleId = "EMPTY", Version = "1", SourceRef = "map" };
            empty.Sha256 = ConcreteTakeoff.ComputeRevitMappingHash(empty);
            registry.ApprovedRevitMappingHashes[ConcreteRuleRegistry.BundleKey(empty.BundleId, empty.Version)] = empty.Sha256;
            Assert(ConcreteTakeoff.MapRevitLedger(rows, empty, registry).Status == StructuralQuantityStatus.REVIEW, "no Revit mapping rules are review, never an implicit match");
        }

        private static void TestStructuralQuantity()
        {
            var bedding = new StructuralLedgerRow { LedgerId = "ZG-BEDDING", Bucket = StructuralQuantityBucket.ConcreteBedding, Operation = StructuralQuantityOperation.Normal, Unit = "m3", SignedQuantity = 48.248m, ExpressionText = "48.248", Source = StructuralEvidence("ZG04A", "FT", "G1", 'a') };
            var plain = new StructuralLedgerRow { LedgerId = "ZG-PLAIN", Bucket = StructuralQuantityBucket.ConcretePlain, Operation = StructuralQuantityOperation.Normal, Unit = "m3", SignedQuantity = 16.401m, ExpressionText = "16.401", Source = StructuralEvidence("ZG04A", "FT", "G2", 'a') };
            var reinforced = new StructuralLedgerRow { LedgerId = "ZG-REINFORCED", Bucket = StructuralQuantityBucket.ConcreteReinforced, Operation = StructuralQuantityOperation.Normal, Unit = "m3", SignedQuantity = 344.572m, ExpressionText = "344.572", Source = StructuralEvidence("ZG04A", "FT", "G3", 'a') };
            var concreteAnchor = new StructuralQuantityAnchor { AnchorId = "ZG-CONCRETE", Bucket = StructuralQuantityBucket.ConcreteAggregate, Unit = "m3", OfficialQuantity = 409.221m, Source = StructuralEvidence("ZG02", "동별 층별 재료별 집계", "C4", 'b'), ExpectedLedgerIds = { "ZG-BEDDING", "ZG-PLAIN", "ZG-REINFORCED" } };
            StructuralQuantityFinding structural = StructuralQuantityValidator.ValidateAnchor(new[] { bedding, plain, reinforced }, concreteAnchor, 0m);
            Assert(structural.Status == StructuralQuantityStatus.PASS && structural.Actual == 409.221m, "ZG concrete child buckets reconcile to official anchor");
            var registry = new StructuralEvidenceRegistry();
            foreach (StructuralSourceEvidence source in new[] { bedding.Source, plain.Source, reinforced.Source, concreteAnchor.Source }) registry.ApprovedSourceHashes[source.SourceId] = source.Sha256;
            concreteAnchor.LedgerSetRule = new StructuralRuleEvidence { RuleId = "ZG-CONCRETE-SET", SourceRef = "approved-ledger-sets.csv", Sha256 = StructuralQuantityValidator.ComputeLedgerSetRuleHash(concreteAnchor) };
            registry.ApprovedRuleHashes[concreteAnchor.LedgerSetRule.RuleId] = concreteAnchor.LedgerSetRule.Sha256;
            Assert(StructuralQuantityValidator.ValidateAnchor(new[] { bedding, plain, reinforced }, concreteAnchor, 0m, registry).Status == StructuralQuantityStatus.PASS, "approved registry binds anchor and child source hashes");
            string approvedSetHash = concreteAnchor.LedgerSetRule.Sha256;
            concreteAnchor.ExpectedLedgerIds.Remove("ZG-REINFORCED");
            Assert(StructuralQuantityValidator.ValidateAnchor(new[] { bedding, plain }, new StructuralQuantityAnchor { AnchorId = "ZG-CONCRETE", Bucket = StructuralQuantityBucket.ConcreteAggregate, Unit = "m3", OfficialQuantity = bedding.SignedQuantity + plain.SignedQuantity, Source = concreteAnchor.Source, LedgerSetRule = concreteAnchor.LedgerSetRule, ExpectedLedgerIds = { "ZG-BEDDING", "ZG-PLAIN" } }, 0m, registry).Status == StructuralQuantityStatus.REVIEW, "approved ledger-set digest cannot be reused for a self-declared subset");
            concreteAnchor.ExpectedLedgerIds.Add("ZG-REINFORCED");
            Assert(concreteAnchor.LedgerSetRule.Sha256 == approvedSetHash, "approved set rule remains immutable evidence");
            var roundedChild = new StructuralLedgerRow { LedgerId = "ROUNDED", Bucket = StructuralQuantityBucket.ConcretePlain, Operation = StructuralQuantityOperation.Normal, Unit = "m3", SignedQuantity = 3.33m, ExpressionText = "10/3", RoundingMode = StructuralRoundingMode.Truncate, RoundingScale = 2, RoundingRule = StructuralRule("UNAPPROVED-ROUND", '6'), Source = StructuralEvidence("ROUNDED-SOURCE", "Sheet", "A1", '6') };
            var roundedAnchor = new StructuralQuantityAnchor { AnchorId = "ROUNDED-ANCHOR", Bucket = StructuralQuantityBucket.ConcretePlain, Unit = "m3", OfficialQuantity = 3.33m, Source = StructuralEvidence("ROUNDED-ANCHOR-SOURCE", "Sheet", "B1", '5'), ExpectedLedgerIds = { "ROUNDED" } };
            roundedAnchor.LedgerSetRule = new StructuralRuleEvidence { RuleId = "ROUNDED-SET", SourceRef = "approved-ledger-sets.csv", Sha256 = StructuralQuantityValidator.ComputeLedgerSetRuleHash(roundedAnchor) };
            foreach (StructuralSourceEvidence source in new[] { roundedChild.Source, roundedAnchor.Source }) registry.ApprovedSourceHashes[source.SourceId] = source.Sha256;
            registry.ApprovedRuleHashes[roundedAnchor.LedgerSetRule.RuleId] = roundedAnchor.LedgerSetRule.Sha256;
            Assert(StructuralQuantityValidator.ValidateAnchor(new[] { roundedChild }, roundedAnchor, 0m, registry).Status == StructuralQuantityStatus.REVIEW, "anchor cannot pass when a child rounding rule is not registry-approved");
            registry.ApprovedSourceHashes[plain.Source.SourceId] = new string('9', 64);
            Assert(StructuralQuantityValidator.ValidateAnchor(new[] { bedding, plain, reinforced }, concreteAnchor, 0m, registry).Status == StructuralQuantityStatus.REVIEW, "self-declared structural source cannot pass without approved registry hash");

            var pureFormwork = new StructuralLedgerRow { LedgerId = "ZJ-FORM", Bucket = StructuralQuantityBucket.PureFormwork, Operation = StructuralQuantityOperation.Normal, Unit = "m2", SignedQuantity = 1759.755m, ExpressionText = "1759.755", Source = StructuralEvidence("ZJ02", "01", "H1", 'c') };
            var accessories = new StructuralLedgerRow { LedgerId = "ZJ-ACCESSORY", Bucket = StructuralQuantityBucket.FormworkAccessory, Operation = StructuralQuantityOperation.Normal, Unit = "m2", SignedQuantity = 957.450m, ExpressionText = "957.45", Source = StructuralEvidence("ZJ02", "01", "H2", 'c') };
            var formAnchor = new StructuralQuantityAnchor { AnchorId = "ZJ-FORM-PACKAGE", Bucket = StructuralQuantityBucket.FormworkPackage, Unit = "m2", OfficialQuantity = 2717.205m, Source = StructuralEvidence("ZJ01", "동별 규격별 집계", "C17", 'd'), ExpectedLedgerIds = { "ZJ-FORM", "ZJ-ACCESSORY" } };
            structural = StructuralQuantityValidator.ValidateAnchor(new[] { pureFormwork, accessories }, formAnchor, 0m);
            Assert(structural.Status == StructuralQuantityStatus.PASS, "pure formwork plus accessories reconcile to package only");

            var directPackage = new StructuralLedgerRow { LedgerId = "FAKE-PARENT", Bucket = StructuralQuantityBucket.FormworkPackage, Operation = StructuralQuantityOperation.Normal, Unit = "m2", SignedQuantity = 2717.205m, ExpressionText = "2717.205", Source = StructuralEvidence("FAKE", "Sheet1", "A1", 'e') };
            structural = StructuralQuantityValidator.ValidateAnchor(new[] { pureFormwork, accessories, directPackage }, formAnchor, 0m);
            Assert(structural.Status == StructuralQuantityStatus.FAIL, "fabricated composite parent row cannot make anchor pass");
            Assert(StructuralQuantityValidator.ValidateAnchor(new[] { pureFormwork, accessories, directPackage }, formAnchor, 0m, registry).Status == StructuralQuantityStatus.FAIL, "registry cannot downgrade an anchor failure to review");
            structural = StructuralQuantityValidator.ValidateAnchor(new[] { bedding, bedding, plain, reinforced }, concreteAnchor, 0m);
            Assert(structural.Status == StructuralQuantityStatus.FAIL, "duplicate ledger ID or source cell cannot hide a missing row");
            var noCompleteness = new StructuralQuantityAnchor { AnchorId = "ZG-CONCRETE-NO-SCOPE", Bucket = StructuralQuantityBucket.ConcreteAggregate, Unit = "m3", OfficialQuantity = 409.221m, Source = StructuralEvidence("ZG02", "Summary", "C4", 'b') };
            Assert(StructuralQuantityValidator.ValidateAnchor(new[] { bedding, plain, reinforced }, noCompleteness, 0m).Status == StructuralQuantityStatus.REVIEW, "anchor cannot pass without approved completeness set");
            var largeMismatch = new StructuralQuantityAnchor { AnchorId = "ZG-CONCRETE-MISMATCH", Bucket = StructuralQuantityBucket.ConcreteAggregate, Unit = "m3", OfficialQuantity = 500m, Source = concreteAnchor.Source, ExpectedLedgerIds = { "ZG-BEDDING", "ZG-PLAIN", "ZG-REINFORCED" } };
            Assert(StructuralQuantityValidator.ValidateAnchor(new[] { bedding, plain, reinforced }, largeMismatch, 1m).Status == StructuralQuantityStatus.FAIL, "missing tolerance rule cannot downgrade an out-of-range anchor mismatch");

            var expressionRow = new StructuralLedgerRow { LedgerId = "EXPR", Bucket = StructuralQuantityBucket.ConcretePlain, Operation = StructuralQuantityOperation.Normal, Unit = "m3", SignedQuantity = 1.08m, ExpressionText = "2.4<길이>*3*0.15*1", Source = StructuralEvidence("ZG04A", "FT", "G5", 'a') };
            Assert(StructuralQuantityValidator.ValidateExpression(expressionRow, 0m).Status == StructuralQuantityStatus.PASS, "annotated raw arithmetic expression");
            expressionRow.ExpressionText = "1<주석>2"; expressionRow.SignedQuantity = 12m;
            Assert(StructuralQuantityValidator.ValidateExpression(expressionRow, 0m).Status == StructuralQuantityStatus.REVIEW, "annotation cannot concatenate two numeric tokens");
            expressionRow.ExpressionText = "10/3"; expressionRow.SignedQuantity = 3.333m; expressionRow.RoundingMode = StructuralRoundingMode.Truncate; expressionRow.RoundingScale = 3; expressionRow.RoundingRule = StructuralRule("RAW-TRUNC-3", 'f');
            Assert(StructuralQuantityValidator.ValidateExpression(expressionRow, 0m).Status == StructuralQuantityStatus.PASS, "explicit versioned truncation rule");
            expressionRow.RoundingRule = null;
            Assert(StructuralQuantityValidator.ValidateExpression(expressionRow, 0.001m).Status == StructuralQuantityStatus.REVIEW, "rounding without approved rule cannot pass by tolerance");
            expressionRow.Source = null;
            Assert(StructuralQuantityValidator.ValidateExpression(expressionRow, 0m).Status == StructuralQuantityStatus.FAIL, "source-less structural value cannot pass");
            Assert(StructuralQuantityValidator.ValidateExpression(expressionRow, 0m, registry).Status == StructuralQuantityStatus.FAIL, "registry cannot downgrade an expression failure to review");

            var reported = StructuralEvidence("ZJ01", "동별 규격별 집계", "C24", 'd');
            var rebar = new StructuralRebarMassEvidence { RebarId = "ZJ-REBAR", ReportedMassKg = 31908.817m, ReportedMassSource = reported };
            Assert(StructuralQuantityValidator.ValidateRebarMass(rebar, 0m).Status == StructuralQuantityStatus.REVIEW, "rebar mass is review without an approved basis");
            rebar.Basis = RebarMassBasis.LengthTimesUnitMass; rebar.BasisRule = StructuralRule("REBAR-MASS-1", '1');
            rebar.LengthM = 30981.03m; rebar.UnitMassKgPerM = 1m; rebar.AllowanceRate = 0.03m;
            rebar.LengthSource = StructuralEvidence("ZJ02", "FT", "H10", 'c'); rebar.UnitMassSource = StructuralEvidence("RULES", "UnitMass", "B2", '1'); rebar.AllowanceSource = StructuralEvidence("RULES", "Allowance", "B3", '1');
            rebar.ToleranceRule = StructuralRule("REBAR-KG-TOL", '3');
            Assert(StructuralQuantityValidator.ValidateRebarMass(rebar, 0.001m).Status == StructuralQuantityStatus.FAIL, "ZJ reported rebar cannot pass an explicit mismatching length basis");
            rebar.ReportedMassKg = 10m; rebar.LengthM = 10m; rebar.UnitMassKgPerM = 1m; rebar.AllowanceRate = 0m;
            rebar.LengthSource = reported; rebar.UnitMassSource = reported; rebar.AllowanceSource = reported;
            Assert(StructuralQuantityValidator.ValidateRebarMass(rebar, 0m).Status == StructuralQuantityStatus.REVIEW, "length basis cannot pass by reusing one source cell for every input");
            rebar.ReportedMassKg = 31908.817m; rebar.LengthM = 30981.03m; rebar.UnitMassKgPerM = 1m; rebar.AllowanceRate = 0.03m;
            rebar.LengthSource = StructuralEvidence("ZJ02", "FT", "H10", 'c'); rebar.UnitMassSource = StructuralEvidence("RULES", "UnitMass", "B2", '1'); rebar.AllowanceSource = StructuralEvidence("RULES", "Allowance", "B3", '1');
            rebar.ToleranceRule = null;
            Assert(StructuralQuantityValidator.ValidateRebarMass(rebar, 1m).Status == StructuralQuantityStatus.FAIL, "missing tolerance rule cannot downgrade an out-of-range rebar mismatch");
            rebar.LengthM = -1m;
            Assert(StructuralQuantityValidator.ValidateRebarMass(rebar, 0m).Status == StructuralQuantityStatus.FAIL, "negative rebar length is invalid input");
            rebar.LengthM = 30981.03m;
            rebar.Basis = RebarMassBasis.ApprovedSchedule; rebar.ApprovedScheduleMassKg = 31908.817m; rebar.ApprovedScheduleSource = StructuralEvidence("APPROVED-SCHEDULE", "Schedule", "D24", '2');
            Assert(StructuralQuantityValidator.ValidateRebarMass(rebar, 0m).Status == StructuralQuantityStatus.PASS, "independent approved schedule can validate reported rebar mass");
            rebar.ApprovedScheduleSource = reported;
            Assert(StructuralQuantityValidator.ValidateRebarMass(rebar, 0m).Status == StructuralQuantityStatus.REVIEW, "same-cell schedule is circular self-validation");
            var caseAliasReported = StructuralEvidence("CASE-A", "Sheet", "A1", '4');
            var caseAliasSchedule = StructuralEvidence("CASE-B", "sheet", "$A$1:$A$1", '4');
            rebar.ReportedMassSource = caseAliasReported; rebar.ApprovedScheduleSource = caseAliasSchedule;
            Assert(StructuralQuantityValidator.ValidateRebarMass(rebar, 0m).Status == StructuralQuantityStatus.REVIEW, "sheet-case and absolute-reference aliases cannot bypass circularity");
            rebar.ReportedMassSource = reported;
            rebar.ReportedMassKg = -1m;
            Assert(StructuralQuantityValidator.ValidateRebarMass(rebar, 0m).Status == StructuralQuantityStatus.FAIL, "official rebar mass cannot be negative");
            Assert(StructuralQuantityValidator.ValidateRebarMass(rebar, 0m, registry).Status == StructuralQuantityStatus.FAIL, "registry cannot downgrade a rebar failure to review");
            rebar.ReportedMassKg = decimal.MaxValue; rebar.Basis = RebarMassBasis.LengthTimesUnitMass; rebar.LengthM = decimal.MaxValue; rebar.UnitMassKgPerM = 2m; rebar.AllowanceRate = 0m;
            Assert(StructuralQuantityValidator.ValidateRebarMass(rebar, 0m).Status == StructuralQuantityStatus.REVIEW, "rebar mass overflow becomes review instead of terminating the run");

            var rebarAnchor = new StructuralQuantityAnchor { AnchorId = "ZG-REBAR", Bucket = StructuralQuantityBucket.RebarMass, Unit = "kg", OfficialQuantity = 30886.375m, Source = StructuralEvidence("ZG03", "재료별 규격별 집계", "E25", 'b'), ExpectedLedgerIds = { "FAKE-KG" } };
            var fakeKg = new StructuralLedgerRow { LedgerId = "FAKE-KG", Bucket = StructuralQuantityBucket.RebarMass, Operation = StructuralQuantityOperation.Normal, Unit = "kg", SignedQuantity = 30886.375m, ExpressionText = "30886.375", Source = StructuralEvidence("FAKE", "Sheet1", "A1", 'e') };
            Assert(StructuralQuantityValidator.ValidateAnchor(new[] { fakeKg }, rebarAnchor, 0m).Status == StructuralQuantityStatus.REVIEW, "rebar kg anchor cannot bypass SQ003 with a copied ledger value");

            var crossBucketDuplicate = new StructuralLedgerRow { LedgerId = bedding.LedgerId, Bucket = StructuralQuantityBucket.PureFormwork, Operation = StructuralQuantityOperation.Normal, Unit = "m2", SignedQuantity = 48.248m, ExpressionText = "48.248", Source = bedding.Source };
            List<StructuralQuantityFinding> collection = StructuralQuantityValidator.Validate(new[] { bedding, crossBucketDuplicate }, new StructuralQuantityAnchor[0], new StructuralRebarMassEvidence[0], 0m);
            Assert(collection.Count(x => x.Rule == "SQ001" && x.Status == StructuralQuantityStatus.FAIL && x.Message.Contains("전체 ledger")) == 2, "global ledger ID and source-cell duplicates fail across buckets");
            collection = StructuralQuantityValidator.Validate(new StructuralLedgerRow[] { null }, new StructuralQuantityAnchor[] { null }, new StructuralRebarMassEvidence[] { null }, 0m, registry);
            Assert(collection.Count == 3 && collection.All(x => x.Status == StructuralQuantityStatus.FAIL), "null collection elements produce explicit failures");

            var badChild = new StructuralLedgerRow { LedgerId = "BAD-CHILD", Bucket = StructuralQuantityBucket.ConcretePlain, Operation = StructuralQuantityOperation.Normal, Unit = "m3", SignedQuantity = 10m, ExpressionText = "999", Source = StructuralEvidence("BAD", "Sheet", "A1", '7') };
            var badChildAnchor = new StructuralQuantityAnchor { AnchorId = "BAD-ANCHOR", Bucket = StructuralQuantityBucket.ConcretePlain, Unit = "m3", OfficialQuantity = 10m, Source = StructuralEvidence("BAD-SUMMARY", "Sheet", "B1", '8'), ExpectedLedgerIds = { "BAD-CHILD" } };
            Assert(StructuralQuantityValidator.ValidateAnchor(new[] { badChild }, badChildAnchor, 0m).Status == StructuralQuantityStatus.FAIL, "anchor cannot pass when a child expression fails");
            badChild.ExpressionText = "10"; badChild.Operation = StructuralQuantityOperation.Unknown;
            Assert(StructuralQuantityValidator.ValidateExpression(badChild, 0m).Status == StructuralQuantityStatus.FAIL, "unknown operation cannot pass");
            badChild.Operation = StructuralQuantityOperation.Normal; badChild.RoundingMode = (StructuralRoundingMode)99;
            Assert(StructuralQuantityValidator.ValidateExpression(badChild, 0m).Status == StructuralQuantityStatus.FAIL, "undefined rounding mode cannot fall through as truncation");
            badChild.RoundingMode = StructuralRoundingMode.None; badChild.SignedQuantity = -1m; badChild.ExpressionText = "-1";
            Assert(StructuralQuantityValidator.ValidateExpression(badChild, 0m).Status == StructuralQuantityStatus.FAIL, "negative signed quantity requires deduction operation");
            badChild.Operation = StructuralQuantityOperation.Deduction; badChild.SignedQuantity = decimal.MinValue; badChild.ExpressionText = "1";
            Assert(StructuralQuantityValidator.ValidateExpression(badChild, 0m).Status == StructuralQuantityStatus.REVIEW, "expression delta overflow becomes review");
            badChildAnchor.OfficialQuantity = 1m;
            Assert(StructuralQuantityValidator.ValidateAnchor(new[] { badChild }, badChildAnchor, 0m).Status == StructuralQuantityStatus.REVIEW, "anchor delta overflow becomes review");

            var fakeQto = new QtoRecord { Category = "Walls", Family = "F", Type = "T", Level = "L1", Count = 1m, VolumeM3 = 1m };
            fakeQto.Id = Input.ComputeQtoAuditKey(fakeQto.Category, fakeQto.Family, fakeQto.Type, fakeQto.Level);
            fakeQto.ElementIds.Add("not-an-id");
            var fakeLine = new EstimateLine { Id = "FAKE-LINE", Unit = "m3", Quantity = 1m, UnitPriceKrw = 1m, AmountKrw = 1m };
            List<Finding> qtoFindings = Preflight.Run(new[] { fakeQto }, new[] { fakeLine },
                new[] { new Mapping { EstimateLineId = "FAKE-LINE", QtoId = fakeQto.Id, Unit = "m3", Multiplier = 1m } }, new AuditPolicy());
            Assert(qtoFindings.Any(finding => finding.Rule == "R030" && finding.Status == "FAIL") &&
                qtoFindings.Any(finding => finding.Rule == "R020" && finding.Status == "FAIL") &&
                !qtoFindings.Any(finding => finding.Rule == "R021" && finding.Status == "PASS"),
                "public core API cannot pass fabricated Revit element IDs");
        }

        private static void TestConcreteTakeoff()
        {
            var bundle = new ConcreteRuleBundle { BundleId = "CONCRETE-DEMO", Version = "1", SourceRef = "approved-rule-table!A1:F2" };
            bundle.Rules.Add(new ConcreteAllowanceRule { Spec = "25-270-15", AllowanceRate = 0.1m, ApplicationBasis = ConcreteAllowanceBasis.Subtotal, DeductionTiming = ConcreteDeductionTiming.BeforeAllowance, RoundingMode = StructuralRoundingMode.HalfUp, RoundingScale = 3 });
            bundle.Sha256 = ConcreteTakeoff.ComputeRuleHash(bundle);
            var registry = new ConcreteRuleRegistry();
            registry.ApprovedHashes[ConcreteRuleRegistry.BundleKey(bundle.BundleId, bundle.Version)] = bundle.Sha256;
            registry.ApprovedSourceHashes["ZG04A"] = new string('a', 64);

            ConcreteInputRow Revit(string id, decimal quantity, StructuralQuantityOperation operation, string element)
            {
                var row = new ConcreteInputRow { RowId = id, SourceKind = ConcreteSourceKind.Revit, Building = "A", Floor = "1F", Member = "Wall", Spec = "25-270-15", SignedQuantityM3 = quantity, Operation = operation };
                row.ElementIds.Add(element);
                return row;
            }
            var left = ConcreteTakeoff.Calculate(new[] { Revit("R1", 100m, StructuralQuantityOperation.Normal, "101"), Revit("R2", -10m, StructuralQuantityOperation.Deduction, "102") }, bundle, registry);
            Assert(left.Status == StructuralQuantityStatus.PASS && left.Rows.Single().RawQuantityM3 == 90m && left.Rows.Single().DeductionQuantityM3 == -10m && left.Rows.Single().AllowanceQuantityM3 == 9m && left.Rows.Single().FinalQuantityM3 == 99m && left.Rows.Single().ElementIds.SequenceEqual(new[] { "101", "102" }), "approved concrete subtotal, deduction, allowance, and evidence");

            var unapproved = ConcreteTakeoff.Calculate(new[] { Revit("R3", 1m, StructuralQuantityOperation.Normal, "103") }, bundle, new ConcreteRuleRegistry());
            Assert(unapproved.Status == StructuralQuantityStatus.REVIEW && !unapproved.Rows.Single().FinalQuantityM3.HasValue, "unapproved concrete rule never passes");
            string approvedHash = bundle.Sha256;
            bundle.Rules[0].AllowanceRate = 0.2m;
            var tamperedRule = ConcreteTakeoff.Calculate(new[] { Revit("R3B", 1m, StructuralQuantityOperation.Normal, "106") }, bundle, registry);
            Assert(tamperedRule.Status == StructuralQuantityStatus.REVIEW && !tamperedRule.Rows.Single().FinalQuantityM3.HasValue, "tampered concrete rule hash never passes");
            bundle.Rules[0].AllowanceRate = 0.1m;
            bundle.Sha256 = approvedHash;
            ConcreteInputRow ambiguous = Revit("R4", 1m, StructuralQuantityOperation.Normal, "104");
            ambiguous.SourceEvidence = StructuralEvidence("ZG04A", "FT", "G4", 'a');
            var ambiguousResult = ConcreteTakeoff.Calculate(new[] { ambiguous }, bundle, registry);
            Assert(ambiguousResult.Status == StructuralQuantityStatus.NOT_EVALUATED && !ambiguousResult.Rows.Single().FinalQuantityM3.HasValue, "ambiguous concrete source never passes");
            var duplicatedEvidence = ConcreteTakeoff.Calculate(new[] { Revit("R7", 1m, StructuralQuantityOperation.Normal, "105"), Revit("R8", 2m, StructuralQuantityOperation.Normal, "0105") }, bundle, registry);
            Assert(duplicatedEvidence.Status == StructuralQuantityStatus.NOT_EVALUATED && duplicatedEvidence.Rows.All(row => !row.FinalQuantityM3.HasValue), "duplicate concrete evidence cannot be double counted");
            ConcreteInputRow sameRowAlias = Revit("R9", 1m, StructuralQuantityOperation.Normal, "107");
            sameRowAlias.ElementIds.Add("0107");
            Assert(ConcreteTakeoff.Calculate(new[] { sameRowAlias }, bundle, registry).Status == StructuralQuantityStatus.NOT_EVALUATED,
                "same-row Revit element aliases cannot be double counted");

            var right = ConcreteTakeoff.Calculate(new[] { Revit("R5", 110m, StructuralQuantityOperation.Normal, "201"), Revit("R6", -10m, StructuralQuantityOperation.Deduction, "202") }, bundle, registry);
            ConcreteReconciliationResult comparison = ConcreteTakeoff.Reconcile(left, right);
            Assert(comparison.Status == StructuralQuantityStatus.REVIEW && comparison.DeltasClose && comparison.TotalDeltaM3 == 11m && comparison.RowDeltaSumM3 == 11m,
                "concrete reconciliation preserves a closed nonzero delta but requires review");
            var missing = ConcreteTakeoff.Calculate(new[] { new ConcreteInputRow { RowId = "Z1", SourceKind = ConcreteSourceKind.Zg, Building = "A", Floor = "2F", Member = "Wall", Spec = "25-270-15", SignedQuantityM3 = 1m, Operation = StructuralQuantityOperation.Normal, SourceEvidence = StructuralEvidence("ZG04A", "FT", "G5", 'a') } }, bundle, registry);
            Assert(ConcreteTakeoff.Reconcile(left, missing).Status != StructuralQuantityStatus.PASS, "missing common concrete key cannot reconcile as pass");
            Assert(missing.Status == StructuralQuantityStatus.PASS, "approved ZG source hash can participate in concrete calculation");
            var unapprovedSource = new ConcreteRuleRegistry();
            unapprovedSource.ApprovedHashes[ConcreteRuleRegistry.BundleKey(bundle.BundleId, bundle.Version)] = bundle.Sha256;
            Assert(ConcreteTakeoff.Calculate(new[] { new ConcreteInputRow { RowId = "Z2", SourceKind = ConcreteSourceKind.Zg, Building = "A", Floor = "2F", Member = "Wall", Spec = "25-270-15", SignedQuantityM3 = 1m, Operation = StructuralQuantityOperation.Normal, SourceEvidence = StructuralEvidence("ZG04A", "FT", "G6", 'b') } }, bundle, unapprovedSource).Status == StructuralQuantityStatus.REVIEW,
                "unapproved ZG source hash cannot produce a pass quantity");
        }

        private static void TestTakeoffReport()
        {
            string directory = Path.Combine(Path.GetTempPath(), "thekie-takeoff-report-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            try
            {
                var takeoff = new ConcreteTakeoffResult { Status = StructuralQuantityStatus.PASS, Rows = new[] { new ConcreteTakeoffRow {
                    SourceKind = ConcreteSourceKind.Zg, Building = "=어린이집", Floor = "  @1F", Member = "'W1", Spec = "25-270-15", Status = StructuralQuantityStatus.PASS,
                    RawQuantityM3 = 12345678901234567890.12345678m, DeductionQuantityM3 = -0.00000001m, AllowanceQuantityM3 = 1.23456789m,
                    FinalQuantityM3 = 12345678901234567891.35802466m, Formula = "ROUND(raw*(1+rate),8)", RuleId = "RULE-1", RuleHash = new string('A', 64),
                    RuleSource = "rules.xlsx!A1", Source = "source=ZG04A;sha256=" + new string('b', 64) + ";sheet=FT;cell=G5", ElementIds = new[] { "101", "102" }, Message = "+verified" } } };
                string path = Path.Combine(directory, "=takeoff.csv");
                var takeoffInputs = new Dictionary<string, string> {
                    ["export_manifest"] = new string('1', 64), ["ifc"] = new string('2', 64), ["qto"] = new string('3', 64),
                    ["element_ledger"] = new string('4', 64), ["revit_mapping"] = new string('5', 64),
                    ["concrete_rules"] = new string('6', 64), ["registry"] = new string('7', 64)
                };
                TakeoffReportArtifact artifact = TakeoffReport.WriteTakeoff(path, takeoff, takeoffInputs);
                TakeoffReportRecord row = TakeoffReport.Read(path).Single();
                Assert(row.RecordType == "TAKEOFF" && row.Status == "PASS" && row.SourceKind == "Zg" && row.Building == "=어린이집" && row.Floor == "  @1F" && row.Member == "'W1" &&
                    row.RawM3 == 12345678901234567890.12345678m && row.DeductionM3 == -0.00000001m && row.AllowanceM3 == 1.23456789m && row.FinalM3 == 12345678901234567891.35802466m &&
                    row.Formula == "ROUND(raw*(1+rate),8)" && row.RuleId == "RULE-1" && row.RuleHash == new string('A', 64) && row.RuleSource == "rules.xlsx!A1" &&
                    row.SourceEvidence.Contains("sheet=FT;cell=G5") && row.ElementIds == "101|102" && row.Message == "+verified",
                    "takeoff report round-trip preserves status, decimals, rules, evidence, and spreadsheet-sensitive text");
                Assert(artifact.ReportSha256 == RunManifest.Hash(path) && TakeoffReport.Verify(path).ReportSha256 == artifact.ReportSha256 &&
                    Csv.Read(artifact.ManifestPath).Any(item => item[0] == "report_sha256" && item[1] == artifact.ReportSha256), "takeoff report manifest binds report hash");
                bool collision = false;
                try { TakeoffReport.WriteTakeoff(path, takeoff); } catch (IOException) { collision = true; }
                Assert(collision && RunManifest.Hash(path) == artifact.ReportSha256, "takeoff report never overwrites an existing bundle");

                TakeoffReportArtifact tampered = TakeoffReport.WriteTakeoff(Path.Combine(directory, "tampered.csv"), takeoff, takeoffInputs);
                File.AppendAllText(tampered.ReportPath, "tampered", Encoding.UTF8);
                bool tamperRejected = false;
                try { TakeoffReport.Verify(tampered.ReportPath); } catch (InvalidDataException) { tamperRejected = true; }
                Assert(tamperRejected, "takeoff report verifier rejects content tampering");

                var bridge = new ConcreteLedgerBridgeResult { Status = StructuralQuantityStatus.REVIEW, RawConcreteQuantityM3 = 1.25m, SelectedConcreteCount = 1, ExcludedUnknownCount = 2, ExcludedNonConcreteCount = 3,
                    Message = "raw only", Rows = new[] { new ConcreteInputRow { RowId = "Z1", SourceKind = ConcreteSourceKind.Zj, Building = "A", Floor = "1F", Member = "W", Spec = "25-180-8", SignedQuantityM3 = 1.25m,
                        Operation = StructuralQuantityOperation.Normal, SourceEvidence = StructuralEvidence("ZJ02", "FT", "H3", 'c') } } };
                IReadOnlyList<TakeoffReportRecord> bridgeRows = TakeoffReport.Read(TakeoffReport.WriteBridge(Path.Combine(directory, "bridge.csv"), bridge).ReportPath);
                Assert(bridgeRows.Count == 2 && bridgeRows[0].RecordType == "BRIDGE_SUMMARY" && bridgeRows[0].Status == "REVIEW" && bridgeRows[1].RawM3 == 1.25m && bridgeRows[1].SourceEvidence.Contains("cell=H3"),
                    "bridge report preserves summary, status, and source cell");

                var reconciliation = new ConcreteReconciliationResult { Status = StructuralQuantityStatus.PASS, DeltasClose = true, LeftTotalM3 = 1m, RightTotalM3 = 1.5m, TotalDeltaM3 = 0.5m, RowDeltaSumM3 = 0.5m,
                    Rows = new[] { new ConcreteReconciliationRow { CommonKey = string.Join("\u001f", "A", "1F", "W", "25-270-15"), Status = StructuralQuantityStatus.PASS,
                        LeftQuantityM3 = 1m, RightQuantityM3 = 1.5m, DeltaM3 = 0.5m, Message = "closed" } } };
                IReadOnlyList<TakeoffReportRecord> reconciliationRows = TakeoffReport.Read(TakeoffReport.WriteReconciliation(Path.Combine(directory, "reconciliation.csv"), reconciliation).ReportPath);
                Assert(reconciliationRows.Count == 2 && reconciliationRows[0].RecordType == "RECONCILIATION_SUMMARY" && reconciliationRows[1].Building == "A" &&
                    reconciliationRows[1].LeftM3 == 1m && reconciliationRows[1].RightM3 == 1.5m && reconciliationRows[1].DeltaM3 == 0.5m,
                    "reconciliation report round-trip preserves common key and closed delta");
            }
            finally { Directory.Delete(directory, true); }
        }

        private static void TestFormworkTakeoff()
        {
            Assert(FormworkTakeoff.Calculate(null, null, null).Status == StructuralQuantityStatus.NOT_EVALUATED,
                "empty formwork scope is not a pass");
            StructuralRuleEvidence policy = StructuralRule("FORMWORK-AIR-V1", 'f');
            StructuralSourceEvidence faceSource = StructuralEvidence("FORMWORK-LEDGER", "faces", "A1", 'e');
            StructuralSourceEvidence decisionSource = StructuralEvidence("FORMWORK-APPROVAL", "approvals", "A1", 'd');
            var approved = new StructuralEvidenceRegistry();
            approved.ApprovedRuleHashes[policy.RuleId] = policy.Sha256;
            approved.ApprovedSourceHashes[faceSource.SourceId] = faceSource.Sha256;
            approved.ApprovedSourceHashes[decisionSource.SourceId] = decisionSource.Sha256;
            FormworkFaceRow Face(string id, string element, string boundaryEvidence, FormworkAreaBasis basis, decimal area, decimal opening, FormworkBoundaryKind boundary, FormworkDecision decision, StructuralRuleEvidence rule = null)
            {
                return new FormworkFaceRow { FaceId = id, ElementId = element, BoundaryEvidenceId = boundaryEvidence, MemberType = "Wall", Level = "1F", AreaBasis = basis, FaceAreaM2 = area, OpeningUnionAreaM2 = opening, BoundaryKind = boundary, Decision = decision, Policy = rule ?? policy, Source = faceSource, DecisionSource = decisionSource };
            }
            var validFaces = new[] {
                Face("F1", "W1", "B1", FormworkAreaBasis.Gross, 10m, 2m, FormworkBoundaryKind.Air, FormworkDecision.Include),
                Face("F2", "S1", "B2", FormworkAreaBasis.Net, 3m, 0m, FormworkBoundaryKind.Air, FormworkDecision.Include),
                Face("F3", "B1", "B3", FormworkAreaBasis.Net, 4m, 0m, FormworkBoundaryKind.ConcreteMember, FormworkDecision.Exclude)
            };
            string validHash = FormworkTakeoff.ComputeLedgerHash(validFaces);
            foreach (FormworkFaceRow face in validFaces) face.GeometryLedgerSha256 = validHash;
            approved.ApprovedDocumentHashes["formwork-face-ledger"] = validHash;
            FormworkAccessoryRow Accessory(string id, FormworkAccessoryKind kind, decimal area) => new FormworkAccessoryRow {
                AccessoryId = id, Kind = kind, AreaM2 = area, Policy = policy, Source = faceSource, AccessoryLedgerId = "formwork-accessory-ledger"
            };
            var validAccessories = new[] { Accessory("PE", FormworkAccessoryKind.PeFilm, 1m), Accessory("BEAD", FormworkAccessoryKind.BeadInsulation, 2m), Accessory("PF", FormworkAccessoryKind.PfInsulation, 3m) };
            string accessoryHash = FormworkTakeoff.ComputeAccessoryLedgerHash(validAccessories);
            foreach (FormworkAccessoryRow item in validAccessories) item.AccessoryLedgerSha256 = accessoryHash;
            approved.ApprovedDocumentHashes["formwork-accessory-ledger"] = accessoryHash;
            var valid = FormworkTakeoff.Calculate(validFaces, validAccessories, approved);
            Assert(valid.Status == StructuralQuantityStatus.PASS && valid.PureFormworkM2 == 11m && valid.PeFilmM2 == 1m && valid.BeadInsulationM2 == 2m && valid.PfInsulationM2 == 3m && valid.LegacyPackageM2 == 17m,
                "formwork face netting and accessory separation: " + valid.Status + "/" + string.Join(" | ", valid.Findings.Select(item => item.SubjectId + ":" + item.Status + ":" + item.Message)));
            validFaces[0].FaceAreaM2 = 1000000m;
            Assert(FormworkTakeoff.Calculate(validFaces, null, approved).Status == StructuralQuantityStatus.REVIEW, "policy cannot approve a changed face ledger whose canonical hash differs");
            validFaces[0].GeometryLedgerSha256 = FormworkTakeoff.ComputeLedgerHash(validFaces);
            Assert(FormworkTakeoff.Calculate(validFaces, null, approved).Status == StructuralQuantityStatus.REVIEW, "self-recomputed face hash is not independently approved");
            var forgedAccessory = validAccessories[0]; forgedAccessory.AreaM2 = 1000000m;
            Assert(FormworkTakeoff.Calculate(null, new[] { forgedAccessory }, approved).Status == StructuralQuantityStatus.REVIEW,
                "accessory area cannot reuse an approved source and policy after changing its ledger content");
            Assert(FormworkTakeoff.Calculate(new[] { Face("N", "E", "N", FormworkAreaBasis.Net, 2m, 1m, FormworkBoundaryKind.Air, FormworkDecision.Include) }, null, approved).Status == StructuralQuantityStatus.FAIL, "net face cannot be rededucted");
            Assert(FormworkTakeoff.Calculate(new[] { Face("G", "E", "G", FormworkAreaBasis.Gross, 2m, 3m, FormworkBoundaryKind.Air, FormworkDecision.Include) }, null, approved).Status == StructuralQuantityStatus.FAIL, "opening union bounds");
            Assert(FormworkTakeoff.Calculate(new[] { Face("C", "E", "C", FormworkAreaBasis.Net, 2m, 0m, FormworkBoundaryKind.ConcreteMember, FormworkDecision.Include) }, null, approved).Status == StructuralQuantityStatus.FAIL, "concrete contact excluded");
            Assert(FormworkTakeoff.Calculate(new[] { Face("U", "E", "U", FormworkAreaBasis.Net, 2m, 0m, FormworkBoundaryKind.Unknown, FormworkDecision.Include) }, null, approved).Status == StructuralQuantityStatus.REVIEW, "unknown boundary review");
            Assert(FormworkTakeoff.Calculate(new[] { Face("P", "E", "P", FormworkAreaBasis.Net, 2m, 0m, FormworkBoundaryKind.Air, FormworkDecision.Include, StructuralRule("NOT-APPROVED", 'a')) }, null, approved).Status == StructuralQuantityStatus.REVIEW, "unapproved policy review");
            Assert(FormworkTakeoff.Calculate(new[] { Face("D", "E", "D1", FormworkAreaBasis.Net, 2m, 0m, FormworkBoundaryKind.Air, FormworkDecision.Include), Face("D", "E2", "D2", FormworkAreaBasis.Net, 2m, 0m, FormworkBoundaryKind.Air, FormworkDecision.Include) }, null, approved).Status == StructuralQuantityStatus.FAIL, "duplicate face blocked");
            Assert(FormworkTakeoff.Calculate(new[] { Face("E1", "E", "same", FormworkAreaBasis.Net, 2m, 0m, FormworkBoundaryKind.Air, FormworkDecision.Include), Face("E2", "E", "same", FormworkAreaBasis.Net, 2m, 0m, FormworkBoundaryKind.Air, FormworkDecision.Include) }, null, approved).Status == StructuralQuantityStatus.FAIL, "duplicate boundary evidence blocked");
            Assert(FormworkTakeoff.Calculate(null, new[] { new FormworkAccessoryRow { AccessoryId = "BAD-PE", Kind = FormworkAccessoryKind.PeFilm, AreaM2 = 1m, IncludedInPureFormwork = true, Policy = policy } }, approved).Status == StructuralQuantityStatus.FAIL, "accessory cannot enter pure formwork");
            Assert(FormworkTakeoff.Calculate(new[] { Face("A", "E", "A", FormworkAreaBasis.GenericAreaM2, 2m, 0m, FormworkBoundaryKind.Air, FormworkDecision.Include) }, null, approved).Status == StructuralQuantityStatus.REVIEW, "generic AreaM2 not evaluated");
        }

        private static void TestFormworkFaceLedgerCsv()
        {
            string directory = Path.Combine(Path.GetTempPath(), "thekie-formwork-ledger-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            try
            {
                string ledger = Path.Combine(directory, "formwork-face-ledger.csv");
                Csv.Write(ledger, new[] {
                    FormworkFaceLedgerCsv.LedgerHeader,
                    new[] { "F1", "100", "100", "Wall", "1F", "Walls", "UNRESOLVED", "10", "UP", "Unknown", "UNRESOLVED", "Review", "geometry only" }
                });
                var raw = new FormworkFaceRow { FaceId = "F1", ElementId = "100", HostElementId = "100", Category = "Walls", MaterialEvidence = "UNRESOLVED", OrientationEvidence = "UP", FaceAreaM2 = 10m };
                string canonical = FormworkTakeoff.ComputeLedgerHash(new[] { raw });
                string sidecar = Path.Combine(directory, "formwork-face-ledger.manifest.csv");
                Csv.Write(sidecar, new[] {
                    FormworkFaceLedgerCsv.ManifestHeader,
                    new[] { "1.0", "2026-01-01T00:00:00.0000000Z", "2026", "formwork-face-ledger.csv", RunManifest.Hash(ledger), canonical, "1", "REVIEW" }
                });
                FormworkFaceLedgerImport imported = FormworkFaceLedgerCsv.ReadExport(ledger);
                Assert(imported.Faces.Count == 1 && imported.Faces[0].BoundaryKind == FormworkBoundaryKind.Unknown && imported.Faces[0].Decision == FormworkDecision.Review,
                    "formwork reader shows extractor Unknown/Review without contact inference");
                string approval = Path.Combine(directory, "formwork-approval.csv");
                var policy = StructuralRule("FW-AIR", 'a');
                Csv.Write(approval, new[] {
                    FormworkFaceLedgerCsv.ApprovalHeader,
                    new[] { "F1", imported.LedgerSha256, "Gross", "0", "Air", "DRAWING-A1", "Include", policy.RuleId, policy.Sha256, policy.SourceRef, "FORMWORK_APPROVAL", "R1", "approval", "A2" }
                });
                IReadOnlyList<FormworkFaceRow> approvedFaces = FormworkFaceLedgerCsv.ApplyApprovals(imported, approval);
                var registry = new StructuralEvidenceRegistry();
                registry.ApprovedSourceHashes["FORMWORK_FACE_LEDGER"] = imported.LedgerSha256;
                registry.ApprovedSourceHashes["FORMWORK_APPROVAL"] = RunManifest.Hash(approval);
                registry.ApprovedRuleHashes[policy.RuleId] = policy.Sha256;
                registry.ApprovedDocumentHashes["formwork-face-ledger"] = imported.CanonicalGeometryLedgerSha256;
                Assert(FormworkTakeoff.Calculate(approvedFaces, null, registry).Status == StructuralQuantityStatus.PASS,
                    "approved face decision binds separate approval CSV and immutable geometry ledger");
                var changed = Csv.Read(approval); changed[1][1] = new string('f', 64); Csv.Write(Path.Combine(directory, "wrong-binding.csv"), changed);
                bool rejected = false; try { FormworkFaceLedgerCsv.ApplyApprovals(imported, Path.Combine(directory, "wrong-binding.csv")); } catch (InvalidDataException) { rejected = true; }
                Assert(rejected, "formwork approval cannot bind a different geometry ledger hash");
                File.AppendAllText(ledger, Environment.NewLine);
                rejected = false; try { FormworkFaceLedgerCsv.ReadExport(ledger); } catch (InvalidDataException) { rejected = true; }
                Assert(rejected, "formwork ledger tampering fails sidecar SHA binding");
            }
            finally { Directory.Delete(directory, true); }
        }

        private static StructuralSourceEvidence StructuralEvidence(string sourceId, string sheet, string cell, char sha)
        {
            return new StructuralSourceEvidence { SourceId = sourceId, Sha256 = new string(sha, 64), Revision = "1", Sheet = sheet, Cell = cell };
        }

        private static StructuralRuleEvidence StructuralRule(string id, char sha)
        {
            return new StructuralRuleEvidence { RuleId = id, Sha256 = new string(sha, 64), SourceRef = "approved-rules.csv" };
        }

        private static void TestXlsx()
        {
            string path = Path.Combine(Path.GetTempPath(), "thekie-self-test.xlsx");
            string noCachePath = Path.Combine(Path.GetTempPath(), "thekie-generic-no-cache-self-test.xlsx");
            string numericIdPath = Path.Combine(Path.GetTempPath(), "thekie-generic-numeric-id-self-test.xlsx");
            try
            {
                WriteGenericEstimateWorkbook(path, "<c r=\"E3\"><f>120000</f><v>120000</v></c>");
                var lines = Input.ReadEstimate(path);
                Assert(lines.Count == 1 && lines[0].Id == "E-1" && lines[0].SourceRow == 3 && lines[0].UnitPriceKrw == 120000m, "xlsx first worksheet and cached formula");
                WriteGenericEstimateWorkbook(noCachePath, "<c r=\"E3\"><f>120000</f></c>");
                bool rejected = false;
                try { Input.ReadEstimate(noCachePath); } catch (FormatException) { rejected = true; }
                Assert(rejected, "generic XLSX formula without a cached numeric value is an input error");
                WriteGenericEstimateWorkbook(numericIdPath, "<c r=\"E3\"><v>120000</v></c>", "<c r=\"A3\"><v>1</v></c>");
                rejected = false;
                try { Input.ReadEstimate(numericIdPath); } catch (FormatException) { rejected = true; }
                Assert(rejected, "generic XLSX machine ID must be an explicit text cell");
            }
            finally
            {
                if (File.Exists(path)) File.Delete(path);
                if (File.Exists(noCachePath)) File.Delete(noCachePath);
                if (File.Exists(numericIdPath)) File.Delete(numericIdPath);
            }
        }

        private static void WriteGenericEstimateWorkbook(string path, string unitPriceCell, string idCell = "<c r=\"A3\" t=\"s\"><v>6</v></c>")
        {
            using (var archive = ZipFile.Open(path, ZipArchiveMode.Create))
            {
                Write(archive, "xl/workbook.xml", "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Estimate\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
                Write(archive, "xl/_rels/workbook.xml.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Target=\"worksheets/sheet7.xml\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\"/></Relationships>");
                Write(archive, "xl/sharedStrings.xml", "<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><si><t>ID</t></si><si><t>Description</t></si><si><t>Unit</t></si><si><t>Quantity</t></si><si><t>UnitPriceKrw</t></si><si><t>AmountKrw</t></si><si><t>E-1</t></si><si><t>Wall</t></si><si><t>m3</t></si></sst>");
                Write(archive, "xl/worksheets/sheet7.xml", "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c><c r=\"C1\" t=\"s\"><v>2</v></c><c r=\"D1\" t=\"s\"><v>3</v></c><c r=\"E1\" t=\"s\"><v>4</v></c><c r=\"F1\" t=\"s\"><v>5</v></c></row><row r=\"3\">" + idCell + "<c r=\"B3\" t=\"s\"><v>7</v></c><c r=\"C3\" t=\"s\"><v>8</v></c><c r=\"D3\"><v>10</v></c>" + unitPriceCell + "<c r=\"F3\"><v>1200000</v></c></row></sheetData></worksheet>");
            }
        }

        private static void TestEmsXlsx()
        {
            string path = Path.Combine(Path.GetTempPath(), "thekie-ems-self-test.xlsx");
            try
            {
                using (var archive = ZipFile.Open(path, ZipArchiveMode.Create))
                {
                    Write(archive, "xl/workbook.xml", "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Summary\" sheetId=\"1\" r:id=\"rId1\"/><sheet name=\"공종별내역서\" sheetId=\"2\" r:id=\"rId2\"/></sheets></workbook>");
                    Write(archive, "xl/_rels/workbook.xml.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\"/><Relationship Id=\"rId2\" Target=\"worksheets/sheet2.xml\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\"/></Relationships>");
                    Write(archive, "xl/worksheets/sheet1.xml", "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"1\"><c r=\"A1\"><v>0</v></c></row></sheetData></worksheet>");
                    Write(archive, "xl/worksheets/sheet2.xml", "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>" +
                        "<row r=\"5\"><c r=\"A5\" t=\"inlineStr\"><is><t>Concrete</t></is></c><c r=\"C5\" t=\"inlineStr\"><is><t>m3</t></is></c><c r=\"D5\"><v>1.4999999999999998</v></c><c r=\"E5\"><v>100</v></c><c r=\"G5\"><v>200</v></c><c r=\"I5\"><v>300</v></c><c r=\"K5\"><v>600</v></c><c r=\"L5\"><v>900</v></c><c r=\"N5\" t=\"inlineStr\"><is><t>ITEM-1</t></is></c></row>" +
                        "<row r=\"6\"><c r=\"A6\" t=\"inlineStr\"><is><t>Concrete</t></is></c><c r=\"C6\" t=\"inlineStr\"><is><t>m3</t></is></c><c r=\"D6\"><v>1</v></c><c r=\"E6\"><v>100</v></c><c r=\"G6\"><v>200</v></c><c r=\"I6\"><v>300</v></c><c r=\"K6\"><v>600</v></c><c r=\"L6\"><v>600</v></c><c r=\"N6\" t=\"inlineStr\"><is><t>ITEM-1</t></is></c></row>" +
                        "<row r=\"7\"><c r=\"A7\" t=\"inlineStr\"><is><t>Incomplete</t></is></c><c r=\"C7\" t=\"inlineStr\"><is><t>m3</t></is></c><c r=\"D7\"><v>2</v></c><c r=\"E7\"><v>100</v></c><c r=\"G7\"><v>200</v></c><c r=\"I7\"><v>300</v></c><c r=\"K7\"><v>600</v></c><c r=\"N7\" t=\"inlineStr\"><is><t>ITEM-2</t></is></c></row>" +
                        "<row r=\"8\"><c r=\"A8\" t=\"inlineStr\"><is><t>Zero quantity</t></is></c><c r=\"C8\" t=\"inlineStr\"><is><t>kg</t></is></c><c r=\"E8\"><v>100</v></c><c r=\"G8\"><v>0</v></c><c r=\"I8\"><v>0</v></c><c r=\"K8\"><v>100</v></c><c r=\"L8\"><v>0</v></c><c r=\"N8\" t=\"inlineStr\"><is><t>ITEM-3</t></is></c></row>" +
                        "</sheetData></worksheet>");
                }
                var lines = Input.ReadEstimate(path);
                Assert(lines.Count == 4 && lines[0].Id == "ITEM-1:5" && lines[0].Quantity == 1.5m && lines[1].Id == "ITEM-1:6" && lines[2].Id == "ITEM-2:7" && !lines[2].AmountKrw.HasValue && !lines[3].Quantity.HasValue && lines[3].MaterialAmountKrw == null && lines[0].UseComponentTruncation && lines[0].MaterialUnitPriceKrw == 100m && lines[0].LaborUnitPriceKrw == 200m && lines[0].ExpenseUnitPriceKrw == 300m, "EMS sheet selection, Excel number normalization, incomplete-row retention, blank-quantity preservation, and unique line key");
                var findings = Preflight.Run(new QtoRecord[0], lines, new Mapping[0], new AuditPolicy());
                Assert(findings.Count(x => x.Rule == "R010" && x.Status == "PASS") == 4 && findings.Count(x => x.Rule == "R011" && x.Status == "PASS") == 2 && findings.Count(x => x.Rule == "R011" && x.Status == "NOT_EVALUATED") == 2, "EMS formulas and missing quantity or amount status");
            }
            finally
            {
                if (File.Exists(path)) File.Delete(path);
            }
        }

        private static void TestEmsInvalidNumberXlsx()
        {
            string path = Path.Combine(Path.GetTempPath(), "thekie-ems-invalid-self-test.xlsx");
            string localePath = Path.Combine(Path.GetTempPath(), "thekie-ems-locale-self-test.xlsx");
            string textPath = Path.Combine(Path.GetTempPath(), "thekie-ems-text-number-self-test.xlsx");
            string noCachePath = Path.Combine(Path.GetTempPath(), "thekie-ems-no-cache-self-test.xlsx");
            string sharedNoCachePath = Path.Combine(Path.GetTempPath(), "thekie-ems-shared-no-cache-self-test.xlsx");
            string invalidQuantityPath = Path.Combine(Path.GetTempPath(), "thekie-ems-invalid-quantity-self-test.xlsx");
            string unsafeMagnitudePath = Path.Combine(Path.GetTempPath(), "thekie-ems-unsafe-magnitude-self-test.xlsx");
            try
            {
                using (var archive = ZipFile.Open(path, ZipArchiveMode.Create))
                {
                    Write(archive, "xl/workbook.xml", "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"공종별내역서\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
                    Write(archive, "xl/_rels/workbook.xml.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\"/></Relationships>");
                    Write(archive, "xl/worksheets/sheet1.xml", "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"5\"><c r=\"C5\" t=\"inlineStr\"><is><t>m2</t></is></c><c r=\"D5\"><v>1</v></c><c r=\"E5\" t=\"inlineStr\"><is><t>#VALUE!</t></is></c><c r=\"N5\" t=\"inlineStr\"><is><t>BAD</t></is></c></row></sheetData></worksheet>");
                }
                bool rejected = false;
                try { Input.ReadEstimate(path); } catch (FormatException) { rejected = true; }
                Assert(rejected, "invalid EMS money cannot disappear");
                using (var archive = ZipFile.Open(localePath, ZipArchiveMode.Create))
                {
                    Write(archive, "xl/workbook.xml", "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"공종별내역서\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
                    Write(archive, "xl/_rels/workbook.xml.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\"/></Relationships>");
                    Write(archive, "xl/worksheets/sheet1.xml", "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"5\"><c r=\"C5\" t=\"inlineStr\"><is><t>m2</t></is></c><c r=\"D5\"><v>1</v></c><c r=\"E5\" t=\"inlineStr\"><is><t>1,5</t></is></c><c r=\"N5\" t=\"inlineStr\"><is><t>BAD-LOCALE</t></is></c></row></sheetData></worksheet>");
                }
                rejected = false;
                try { Input.ReadEstimate(localePath); } catch (FormatException) { rejected = true; }
                Assert(rejected, "locale comma decimal is not reinterpreted in EMS XLSX");
                WriteEmsSingleRowWorkbook(textPath, "<c r=\"D5\"><v>1</v></c><c r=\"E5\" t=\"inlineStr\"><is><t>100</t></is></c><c r=\"G5\"><v>0</v></c><c r=\"I5\"><v>0</v></c><c r=\"K5\"><v>100</v></c><c r=\"L5\"><v>100</v></c>");
                rejected = false;
                try { Input.ReadEstimate(textPath); } catch (FormatException) { rejected = true; }
                Assert(rejected, "text-typed EMS money cannot pass as a number");
                WriteEmsSingleRowWorkbook(noCachePath, "<c r=\"D5\"><v>1</v></c><c r=\"E5\"><f>1+1</f></c><c r=\"G5\"><v>0</v></c><c r=\"I5\"><v>0</v></c><c r=\"K5\"><v>2</v></c><c r=\"L5\"><v>2</v></c>");
                rejected = false;
                try { Input.ReadEstimate(noCachePath); } catch (FormatException) { rejected = true; }
                Assert(rejected, "EMS formula without cached value cannot disappear as blank");
                WriteEmsSingleRowWorkbook(sharedNoCachePath, "<c r=\"D5\"><v>1</v></c><c r=\"E5\"><f t=\"shared\" si=\"0\"/></c><c r=\"G5\"><f t=\"shared\" si=\"1\"/></c><c r=\"I5\"><f t=\"shared\" si=\"2\"/></c><c r=\"K5\"><f t=\"shared\" si=\"3\"/></c><c r=\"L5\"><f t=\"shared\" si=\"4\"/></c>");
                rejected = false;
                try { Input.ReadEstimate(sharedNoCachePath); } catch (FormatException) { rejected = true; }
                Assert(rejected, "shared-formula slave cells without cached values cannot disappear as a blank EMS row");
                WriteEmsSingleRowWorkbook(invalidQuantityPath, "<c r=\"D5\" t=\"e\"><v>#VALUE!</v></c><c r=\"E5\"><v>1</v></c><c r=\"G5\"><v>0</v></c><c r=\"I5\"><v>0</v></c><c r=\"K5\"><v>1</v></c><c r=\"L5\"><v>1</v></c>");
                rejected = false;
                try { Input.ReadEstimate(invalidQuantityPath); } catch (FormatException) { rejected = true; }
                Assert(rejected, "invalid nonblank EMS quantity is an input error");
                WriteEmsSingleRowWorkbook(unsafeMagnitudePath, "<c r=\"D5\"><v>1</v></c><c r=\"E5\"><v>9007199254740992</v></c><c r=\"G5\"><v>0</v></c><c r=\"I5\"><v>0</v></c><c r=\"K5\"><v>9007199254740992</v></c><c r=\"L5\"><v>9007199254740992</v></c>");
                rejected = false;
                try { Input.ReadEstimate(unsafeMagnitudePath); } catch (FormatException) { rejected = true; }
                Assert(rejected, "unsafe Excel magnitude is rejected before double normalization can collapse values");
            }
            finally
            {
                foreach (string file in new[] { path, localePath, textPath, noCachePath, sharedNoCachePath, invalidQuantityPath, unsafeMagnitudePath })
                    if (File.Exists(file)) File.Delete(file);
            }
        }

        private static void WriteEmsSingleRowWorkbook(string path, string numericCells)
        {
            using (var archive = ZipFile.Open(path, ZipArchiveMode.Create))
            {
                Write(archive, "xl/workbook.xml", "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"공종별내역서\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
                Write(archive, "xl/_rels/workbook.xml.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\"/></Relationships>");
                Write(archive, "xl/worksheets/sheet1.xml", "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"5\"><c r=\"A5\" t=\"inlineStr\"><is><t>Item</t></is></c><c r=\"C5\" t=\"inlineStr\"><is><t>m2</t></is></c>" + numericCells + "<c r=\"N5\" t=\"inlineStr\"><is><t>ITEM</t></is></c></row></sheetData></worksheet>");
            }
        }

        private static void TestEmsSummaryXlsx()
        {
            string path = Path.Combine(Path.GetTempPath(), "thekie-ems-summary-self-test.xlsx");
            string duplicatePath = Path.Combine(Path.GetTempPath(), "thekie-ems-summary-duplicate-self-test.xlsx");
            try
            {
                string[] codes = { "AS", "B2", "BS", "C4", "C5", "C6", "C7", "CA", "CB", "CG", "CH", "CS", "S1", "D1", "D2", "D9", "DB", "DH", "S2", "D7", "DK", "DL", "DM" };
                WriteSummaryWorkbook(path, string.Join("", codes.Select((code, index) => SummaryRow(index + 1, code, index + 100))));
                var summary = Input.ReadEstimateSummary(path);
                Assert(summary != null && summary.MaterialSubtotal == 100m && summary.TotalAmount == 118m && summary.SupplyAdditions == 119m && summary.FinalAdditions == 363m && summary.SourceRows["D9"] == 16, "EMS summary sheet parsing");
                WriteSummaryWorkbook(duplicatePath, SummaryRow(1, "AS", 1) + SummaryRow(2, "AS", 2));
                bool rejected = false;
                try { Input.ReadEstimateSummary(duplicatePath); } catch (FormatException) { rejected = true; }
                Assert(rejected, "duplicate EMS summary code rejected");
                File.Delete(duplicatePath);
                WriteSummaryWorkbook(duplicatePath, SummaryRow(1, "AS", 1) + "<row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>AS</t></is></c><c r=\"E2\" t=\"inlineStr\"><is><t>#VALUE!</t></is></c></row>");
                rejected = false;
                try { Input.ReadEstimateSummary(duplicatePath); } catch (FormatException) { rejected = true; }
                Assert(rejected, "invalid duplicate EMS summary code rejected");
                File.Delete(duplicatePath);
                WriteSummaryWorkbook(duplicatePath, "<row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>D7</t></is></c><c r=\"E1\" t=\"inlineStr\"><is><t>#VALUE!</t></is></c></row>");
                rejected = false;
                try { Input.ReadEstimateSummary(duplicatePath); } catch (FormatException) { rejected = true; }
                Assert(rejected, "present invalid optional EMS summary value rejected");
            }
            finally
            {
                if (File.Exists(path)) File.Delete(path);
                if (File.Exists(duplicatePath)) File.Delete(duplicatePath);
            }
        }

        private static void WriteSummaryWorkbook(string path, string rows)
        {
            using (var archive = ZipFile.Open(path, ZipArchiveMode.Create))
            {
                Write(archive, "xl/workbook.xml", "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"원가계산서\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
                Write(archive, "xl/_rels/workbook.xml.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\"/></Relationships>");
                Write(archive, "xl/worksheets/sheet1.xml", "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>" + rows + "</sheetData></worksheet>");
            }
        }

        private static string SummaryRow(int row, string code, int value)
        {
            return "<row r=\"" + row + "\"><c r=\"A" + row + "\" t=\"inlineStr\"><is><t>" + code + "</t></is></c><c r=\"E" + row + "\"><v>" + value + "</v></c></row>";
        }

        private static void Write(ZipArchive archive, string path, string contents)
        {
            using (var writer = new StreamWriter(archive.CreateEntry(path).Open(), new UTF8Encoding(false))) writer.Write(contents);
        }

        private static void TestCsv()
        {
            string path = Path.Combine(Path.GetTempPath(), "thekie-self-test.csv");
            try
            {
                Csv.Write(path, new[] { new[] { "ID", "Description" }, new[] { "E-2", "Beam, first\nsecond \"quoted\" value" } });
                var rows = Csv.Read(path);
                Assert(rows.Count == 2 && rows[1][1] == "Beam, first\nsecond \"quoted\" value", "quoted multiline csv");
                Assert(Csv.SpreadsheetText("=1+1") == "'=1+1" && Csv.SpreadsheetText("  @SUM(A1:A2)") == "  '@SUM(A1:A2)" && Csv.SpreadsheetText("-100") == "'-100", "spreadsheet formula injection text neutralization");
                Csv.Write(path, new[] { new[] { "ID", "ID", "Description", "Unit", "Quantity", "UnitPriceKrw", "AmountKrw" }, new[] { "E-2", "E-2", "Beam", "m", "1", "1", "1" } });
                bool rejected = false;
                try { Input.ReadEstimate(path); } catch (FormatException) { rejected = true; }
                Assert(rejected, "duplicate header rejected");
                Csv.Write(path, new[] { new[] { "내역ID", "품명", "단위", "수량", "단가", "금액" } });
                rejected = false;
                try { Input.ReadEstimate(path); } catch (FormatException) { rejected = true; }
                Assert(rejected, "header-only estimate is not a successful empty audit");
                Csv.Write(path, new[] { new[] { "내역ID", "검산키", "단위", "계수", "승인" } });
                Assert(Input.ReadMappings(path).Count == 0, "empty approved mapping set remains a valid arithmetic-only audit input");
                Csv.Write(path, new[] { new[] { "내역ID", "품명", "단위", "수량", "단가", "금액" }, new[] { "-BOQ-1", "Wall", "m2", "1", "1", "1" } });
                rejected = false;
                try { Input.ReadEstimate(path); } catch (FormatException) { rejected = true; }
                Assert(rejected, "machine identifiers that would become Excel formulas are rejected");
            }
            finally
            {
                if (File.Exists(path)) File.Delete(path);
            }
        }

        private static void TestQtoTraceabilityInput()
        {
            string path = Path.Combine(Path.GetTempPath(), "thekie-qto-traceability.csv");
            string[] header = { "검산키", "분류", "패밀리", "타입", "레벨", "수량", "체적_m3", "면적_m2", "길이_m", "요소ID" };
            try
            {
                Action<string[][]> rejected = rows => {
                    Csv.Write(path, new[] { header }.Concat(rows));
                    bool failed = false;
                    try { Input.ReadQto(path); } catch (FormatException) { failed = true; }
                    Assert(failed, "invalid QTO traceability input rejected");
                };
                string q1Key = AuditKey("벽", "F", "T", "L1"), q2Key = AuditKey("벽", "F", "T", "L2");
                rejected(new[] { new[] { q1Key, "벽", "F", "T", "L1", "1", "0", "1", "0", "not-a-revit-id" } });
                rejected(new[] { new[] { q1Key, "벽", "F", "T", "L1", "2", "0", "1", "0", "1001" } });
                rejected(new[] { new[] { q1Key, "벽", "F", "T", "L1", "2", "0", "1", "0", "1001|1001" } });
                rejected(new[] { new[] { q1Key, "벽", "F", "T", "L1", "2", "0", "1", "0", "1|01" } });
                rejected(new[] { new[] { q1Key, "벽", "F", "T", "L1", "0", "1", "0", "0", "" } });
                rejected(new[] {
                    new[] { q1Key, "벽", "F", "T", "L1", "1", "0", "1", "0", "1001" },
                    new[] { q2Key, "벽", "F", "T", "L2", "1", "0", "1", "0", "1001" }
                });
                rejected(new[] {
                    new[] { q1Key, "벽", "F", "T", "L1", "1", "0", "1", "0", "1" },
                    new[] { q2Key, "벽", "F", "T", "L2", "1", "0", "1", "0", "01" }
                });
                rejected(new[] {
                    new[] { q1Key, "벽", "F", "T", "L1", "1", "0", "1", "0", "1" },
                    new[] { q1Key.ToLowerInvariant(), "벽", "F", "T", "L1", "1", "0", "1", "0", "2" }
                });
                rejected(new[] { new[] { "Q1", "벽", "F", "T", "L1", "1", "0", "1", "0", "1001" } });
                Csv.Write(path, new[] { header, new[] { q1Key.ToLowerInvariant(), "벽", "F", "T", "L1", "2", "0", "1", "0", "1001|1002" } });
                QtoRecord normalized = Input.ReadQto(path).Single();
                Assert(normalized.Id == q1Key && normalized.ElementIds.SequenceEqual(new[] { "1001", "1002" }), "valid QTO key casing normalized and element IDs preserved");
            }
            finally { if (File.Exists(path)) File.Delete(path); }
        }

        private static string AuditKey(string category, string family, string type, string level)
        {
            using (var sha = System.Security.Cryptography.SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(category + "\u001F" + family + "\u001F" + type + "\u001F" + level))).Replace("-", "");
        }

        private static void TestPublicQtoCrossRowTraceability()
        {
            var q1 = new QtoRecord { Category = "Walls", Family = "F", Type = "T", Level = "L1", Count = 1m, AreaM2 = 5m, SourceRow = 10 };
            q1.Id = Input.ComputeQtoAuditKey(q1.Category, q1.Family, q1.Type, q1.Level);
            q1.ElementIds.Add("1");
            var q2 = new QtoRecord { Category = "Walls", Family = "F", Type = "T", Level = "L2", Count = 1m, AreaM2 = 5m, SourceRow = 20 };
            q2.Id = Input.ComputeQtoAuditKey(q2.Category, q2.Family, q2.Type, q2.Level);
            q2.ElementIds.Add("01");
            var line = new EstimateLine { Id = "LINE-1", Unit = "m2", Quantity = 5m, UnitPriceKrw = 1m, AmountKrw = 5m, SourceRow = 30 };
            var mapping = new Mapping { EstimateLineId = "LINE-1", QtoId = q1.Id, Unit = "m2", Multiplier = 1m, SourceRow = 40 };

            List<Finding> findings = Preflight.Run(new[] { q1, q2 }, new[] { line }, new[] { mapping }, new AuditPolicy());
            Assert(findings.Where(finding => finding.Rule == "R030" && finding.Status == "FAIL").Select(finding => finding.QtoId).SequenceEqual(new[] { q1.Id, q2.Id }),
                "cross-row aliases invalidate every involved QTO deterministically");
            Assert(findings.Any(finding => finding.Rule == "R020" && finding.Status == "FAIL" && finding.QtoId == q1.Id) &&
                findings.Any(finding => finding.Rule == "R021" && finding.Status == "NOT_EVALUATED" && finding.LineId == "LINE-1") &&
                !findings.Any(finding => finding.Rule == "R021" && finding.Status == "PASS"),
                "cross-row duplicate element IDs cannot pass BIM quantity comparison");
            Assert(findings.Count(finding => finding.Rule == "R022" && (finding.QtoId == q1.Id || finding.QtoId == q2.Id)) == 2,
                "invalid cross-row QTO records are excluded from coverage");
            q2.ElementIds.Clear(); q2.ElementIds.Add("2"); q2.Id = "FORGED";
            findings = Preflight.Run(new[] { q2 }, new[] { line }, new[] { new Mapping { EstimateLineId = line.Id, QtoId = q2.Id, Unit = "m2", Multiplier = 1m } }, new AuditPolicy());
            Assert(findings.Any(finding => finding.Rule == "R030" && finding.Status == "FAIL") &&
                !findings.Any(finding => finding.Rule == "R021" && finding.Status == "PASS"),
                "public API cannot pass a forged QTO audit key");
            q2.Id = Input.ComputeQtoAuditKey(q2.Category, q2.Family, q2.Type, q2.Level).ToLowerInvariant();
            findings = Preflight.Run(new[] { q2 }, new[] { line }, new[] { new Mapping { EstimateLineId = line.Id, QtoId = q2.Id, Unit = "m2", Multiplier = 1m } }, new AuditPolicy());
            Assert(findings.Any(finding => finding.Rule == "R030" && finding.Status == "FAIL") &&
                findings.Any(finding => finding.Rule == "R020" && finding.Status == "FAIL") &&
                !findings.Any(finding => finding.Rule == "R021" && finding.Status == "PASS"),
                "public API requires the canonical uppercase QTO audit key");
        }

        private static void TestPreflightBoundaryInputs()
        {
            List<Finding> findings = Preflight.Run(new QtoRecord[0], new EstimateLine[0], new Mapping[0], new AuditPolicy());
            Assert(findings.Count == 1 && findings[0].Rule == "R030" && findings[0].Status == "FAIL",
                "public Core API cannot report an empty audit scope as success");
            var overflowLine = new EstimateLine
            {
                Id = "OVERFLOW-AMOUNT", Unit = "m2", Quantity = decimal.MaxValue,
                UnitPriceKrw = decimal.MaxValue, AmountKrw = 0m
            };
            findings = Preflight.Run(new QtoRecord[0], new[] { overflowLine }, new Mapping[0], new AuditPolicy());
            Assert(findings.Any(finding => finding.Rule == "R030" && finding.Status == "FAIL" && finding.LineId == overflowLine.Id),
                "decimal overflow becomes an explicit input finding");

            var overflowQto = new QtoRecord
            {
                Category = "Walls", Family = "F", Type = "T", Level = "L1",
                Count = 1m, AreaM2 = decimal.MaxValue
            };
            overflowQto.Id = Input.ComputeQtoAuditKey(overflowQto.Category, overflowQto.Family, overflowQto.Type, overflowQto.Level);
            overflowQto.ElementIds.Add("1");
            var line = new EstimateLine { Id = "OVERFLOW-QTO", Unit = "m2", Quantity = 1m, UnitPriceKrw = 1m, AmountKrw = 1m };
            var mapping = new Mapping { EstimateLineId = line.Id, QtoId = overflowQto.Id, Unit = "m2", Multiplier = 2m };
            findings = Preflight.Run(new[] { overflowQto }, new[] { line }, new[] { mapping }, new AuditPolicy());
            Assert(findings.Any(finding => finding.Rule == "R030" && finding.Status == "FAIL" && finding.LineId == line.Id) &&
                findings.Any(finding => finding.Rule == "R021" && finding.Status == "NOT_EVALUATED") &&
                !findings.Any(finding => finding.Rule == "R021" && finding.Status == "PASS"),
                "QTO multiplication overflow cannot pass or terminate without a finding");

            Action<Action> rejectsNullElement = action =>
            {
                bool rejected = false;
                try { action(); } catch (ArgumentException) { rejected = true; }
                Assert(rejected, "public collection null element rejected with a contract error");
            };
            rejectsNullElement(() => Preflight.Run(new QtoRecord[] { null }, new EstimateLine[0], new Mapping[0], new AuditPolicy()));
            rejectsNullElement(() => Preflight.Run(new QtoRecord[0], new EstimateLine[] { null }, new Mapping[0], new AuditPolicy()));
            rejectsNullElement(() => Preflight.Run(new QtoRecord[0], new EstimateLine[0], new Mapping[] { null }, new AuditPolicy()));
            findings = Preflight.Run(new QtoRecord[0], new[] { new EstimateLine { Id = "NO-UNIT", Quantity = 1m, UnitPriceKrw = 1m, AmountKrw = 1m } }, new Mapping[0], new AuditPolicy());
            Assert(findings.Any(finding => finding.Rule == "R030" && finding.Status == "FAIL" && finding.LineId == "NO-UNIT"),
                "public estimate line requires a unit");
            findings = Preflight.Run(new QtoRecord[0], new[] { new EstimateLine { Id = "LINE", Unit = "m2", Quantity = 1m, UnitPriceKrw = 1m, AmountKrw = 1m } },
                new[] { new Mapping { EstimateLineId = null, QtoId = "Q", Unit = "m2", Multiplier = 1m } }, new AuditPolicy());
            Assert(findings.Any(finding => finding.Rule == "R030" && finding.Status == "FAIL") &&
                findings.Any(finding => finding.Rule == "R021" && finding.Status == "NOT_EVALUATED"),
                "mapping with a missing owner produces findings instead of a grouping crash");
        }

        private static void TestMappingTemplate()
        {
            string template = Path.Combine(Path.GetTempPath(), "thekie-mapping-template.xlsx");
            string index = Path.Combine(Path.GetTempPath(), "thekie-qto-index.xlsx");
            try
            {
                var qto = new QtoRecord { Id = "Q-1", Category = "Walls", Count = 1, AreaM2 = 10 };
                qto.ElementIds.Add("1");
                MappingTemplate.Write(template, index, new[] { new EstimateLine { Id = "E-1", Description = "Wall", Unit = "m2", Quantity = 10 } }, new[] { qto });
                var templateRows = Xlsx.ReadFirstSheet(template);
                var indexRows = Xlsx.ReadFirstSheet(index);
                Assert(templateRows.Count == 2 && templateRows[1][0] == "E-1" && templateRows[1][7] == "", "mapping template");
                Assert(indexRows.Count == 2 && indexRows[1][0] == "Q-1", "qto index");
                File.Delete(template);
                Xlsx.WriteTextSheet(template, "매핑", new[] { templateRows[0], new[] { "E-1", "Wall", "m2", "10", "Q-1", "㎡", "1", "Y" }, new[] { "E-2", "Floor", "m2", "5", "", "m2", "1", "" } });
                var approved = Input.ReadMappings(template);
                Assert(approved.Count == 1 && approved[0].Unit == "m2", "approved mapping filter and unit normalization");
                bool rejected = false;
                try { MappingTemplate.Write(template, index, new[] { new EstimateLine { Id = "-BOQ-1", Unit = "m2" } }, new[] { qto }); }
                catch (ArgumentException) { rejected = true; }
                Assert(rejected, "mapping template cannot mutate a formula-leading machine identifier");
                File.Delete(template); File.Delete(index);
                MappingTemplate.Write(template, index, new[] { new EstimateLine { Id = "001", Description = "Wall", Unit = "m2", Quantity = 10 } }, new[] { qto });
                templateRows = Xlsx.ReadFirstSheet(template);
                Assert(templateRows[1][0] == "001", "XLSX mapping template preserves numeric-looking machine IDs as text");
                templateRows[1][4] = "Q-1"; templateRows[1][7] = "Y";
                File.Delete(template);
                Xlsx.WriteTextSheet(template, "매핑", templateRows);
                Assert(Input.ReadMappings(template).Single().EstimateLineId == "001", "numeric-looking machine ID round-trips through approved XLSX mapping");
            }
            finally
            {
                if (File.Exists(template)) File.Delete(template);
                if (File.Exists(index)) File.Delete(index);
            }
        }

        private static void TestFormulaProvenance()
        {
            string directory = Path.Combine(Path.GetTempPath(), "lukas-formula-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            string origin = Path.Combine(directory, "origin.xlsx");
            string exact = Path.Combine(directory, "exact.xlsx");
            string flattened = Path.Combine(directory, "flattened.xlsx");
            string changedValue = Path.Combine(directory, "changed-value.xlsx");
            string changedFormula = Path.Combine(directory, "changed-formula.xlsx");
            string emptyCore = Path.Combine(directory, "no-core.xlsx");
            string emptyRecognizedCore = Path.Combine(directory, "empty-core.xlsx");
            string unresolved = Path.Combine(directory, "unresolved-shared.xlsx");
            string origin2d = Path.Combine(directory, "origin-2d.xlsx");
            string shared2d = Path.Combine(directory, "shared-2d.xlsx");
            string stringFormulaA = Path.Combine(directory, "string-a.xlsx");
            string stringFormulaB = Path.Combine(directory, "string-b.xlsx");
            string missingCacheOrigin = Path.Combine(directory, "missing-cache-origin.xlsx");
            string missingCacheDerivative = Path.Combine(directory, "missing-cache-derivative.xlsx");
            string arrayFormula = Path.Combine(directory, "array-formula.xlsx");
            string normalFormula = Path.Combine(directory, "normal-formula.xlsx");
            string paddedSettingsA = Path.Combine(directory, "settings-a.xlsx");
            string paddedSettingsB = Path.Combine(directory, "settings-b.xlsx");
            string formulaCaseA = Path.Combine(directory, "formula-case-a.xlsx");
            string formulaCaseB = Path.Combine(directory, "formula-case-b.xlsx");
            string numericValue = Path.Combine(directory, "numeric-value.xlsx");
            string booleanValue = Path.Combine(directory, "boolean-value.xlsx");
            try
            {
                WriteFormulaWorkbook(origin,
                    "<row r=\"1\"><c r=\"A1\"><f>1+1</f><v>2</v></c></row>" +
                    "<row r=\"2\"><c r=\"A2\"><f>A1+1</f><v>3</v></c></row>" +
                    "<row r=\"3\"><c r=\"A3\"><f>A2+1</f><v>4</v></c></row>");
                WriteFormulaWorkbook(exact,
                    "<row r=\"1\"><c r=\"A1\"><f>1+1</f><v>2</v></c></row>" +
                    "<row r=\"2\"><c r=\"A2\"><f t=\"shared\" si=\"0\" ref=\"A2:A3\">A1+1</f><v>3</v></c></row>" +
                    "<row r=\"3\"><c r=\"A3\"><f t=\"shared\" si=\"0\"/><v>4</v></c></row>");
                WriteFormulaWorkbook(flattened,
                    "<row r=\"1\"><c r=\"A1\"><f>1+1</f><v>2</v></c></row>" +
                    "<row r=\"2\"><c r=\"A2\"><f>A1+1</f><v>3</v></c></row>" +
                    "<row r=\"3\"><c r=\"A3\"><v>4</v></c></row>");
                WriteFormulaWorkbook(changedValue,
                    "<row r=\"1\"><c r=\"A1\"><f>1+1</f><v>2</v></c></row>" +
                    "<row r=\"2\"><c r=\"A2\"><f>A1+1</f><v>3</v></c></row>" +
                    "<row r=\"3\"><c r=\"A3\"><f>A2+1</f><v>5</v></c></row>");
                WriteFormulaWorkbook(changedFormula,
                    "<row r=\"1\"><c r=\"A1\"><f>1+1</f><v>2</v></c></row>" +
                    "<row r=\"2\"><c r=\"A2\"><f>A1+1</f><v>3</v></c></row>" +
                    "<row r=\"3\"><c r=\"A3\"><f>A1+2</f><v>4</v></c></row>");
                WriteFormulaWorkbook(emptyCore, "<row r=\"1\"><c r=\"A1\"><v>1</v></c></row>", "Sheet1");
                WriteFormulaWorkbook(emptyRecognizedCore, "");
                WriteFormulaWorkbook(unresolved, "<row r=\"1\"><c r=\"A1\"><f t=\"shared\" si=\"99\"/><v>2</v></c></row>");
                WriteFormulaWorkbook(origin2d,
                    "<row r=\"2\"><c r=\"B2\"><f>A1+1</f><v>2</v></c><c r=\"C2\"><f>B1+1</f><v>3</v></c></row>" +
                    "<row r=\"3\"><c r=\"B3\"><f>A2+1</f><v>3</v></c><c r=\"C3\"><f>B2+1</f><v>4</v></c></row>");
                WriteFormulaWorkbook(shared2d,
                    "<row r=\"2\"><c r=\"B2\"><f t=\"shared\" si=\"1\" ref=\"B2:C3\">A1+1</f><v>2</v></c><c r=\"C2\"><f t=\"shared\" si=\"1\"/><v>3</v></c></row>" +
                    "<row r=\"3\"><c r=\"B3\"><f t=\"shared\" si=\"1\"/><v>3</v></c><c r=\"C3\"><f t=\"shared\" si=\"1\"/><v>4</v></c></row>");
                WriteFormulaWorkbook(stringFormulaA, "<row r=\"1\"><c r=\"A1\" t=\"str\"><f>=&quot;A1&quot;</f><v>same-cache</v></c></row>");
                WriteFormulaWorkbook(stringFormulaB, "<row r=\"1\"><c r=\"A1\" t=\"str\"><f>=&quot;a1&quot;</f><v>same-cache</v></c></row>");
                WriteFormulaWorkbook(missingCacheOrigin, "<row r=\"1\"><c r=\"A1\"><f>1+1</f></c><c r=\"B1\"><v>9</v></c></row>");
                WriteFormulaWorkbook(missingCacheDerivative, "<row r=\"1\"><c r=\"B1\"><v>9</v></c></row>");
                WriteFormulaWorkbook(arrayFormula, "<row r=\"1\"><c r=\"A1\"><f t=\"array\" ref=\"A1\">1+1</f><v>2</v></c></row>");
                WriteFormulaWorkbook(normalFormula, "<row r=\"1\"><c r=\"A1\"><f>1+1</f><v>2</v></c></row>");
                WriteFormulaWorkbook(paddedSettingsA, "<row r=\"1\"><c r=\"A1\"><f>1+1</f><v>2</v></c></row>", " 공사설정 ");
                WriteFormulaWorkbook(paddedSettingsB, "<row r=\"1\"><c r=\"A1\"><f>1+2</f><v>3</v></c></row>", " 공사설정 ");
                WriteFormulaWorkbook(formulaCaseA, "<row r=\"1\"><c r=\"A1\" t=\"str\"><f>sum(A2)+&quot;abc&quot;</f><v>abc</v></c></row>");
                WriteFormulaWorkbook(formulaCaseB, "<row r=\"1\"><c r=\"A1\" t=\"str\"><f>SUM(a2)+&quot;abc&quot;</f><v>abc</v></c></row>");
                WriteFormulaWorkbook(numericValue, "<row r=\"1\"><c r=\"A1\"><f>1</f><v>1</v></c></row>");
                WriteFormulaWorkbook(booleanValue, "<row r=\"1\"><c r=\"A1\" t=\"b\"><f>1</f><v>1</v></c></row>");

                FormulaComparison comparison = FormulaProvenance.Compare(exact, origin);
                Assert(comparison.Classification == "EXACT_EQUIVALENT" && comparison.DisplayedValuesEqual && comparison.FormulasEqual && comparison.DerivativeFormulaCount == 3, "shared formulas expand to exact provenance");
                comparison = FormulaProvenance.Compare(flattened, origin);
                Assert(comparison.Classification == "FLATTENED_DERIVATIVE" && comparison.DerivativeFormulaCount == 2 && comparison.OriginFormulaCount == 3, "flattened formula derivative classification");
                comparison = FormulaProvenance.Compare(changedValue, origin);
                Assert(comparison.Classification == "UNRELATED" && comparison.ValueMismatches.Contains("원가계산서!A3"), "changed cached value is unrelated");
                comparison = FormulaProvenance.Compare(changedFormula, origin);
                Assert(comparison.Classification == "UNRELATED" && comparison.FormulaMismatches.Contains("원가계산서!A3"), "changed formula is unrelated");
                comparison = FormulaProvenance.Compare(emptyCore, emptyCore);
                Assert(comparison.Classification == "UNRELATED" && comparison.DerivativeCoreSheetCount == 0, "empty core workbook cannot be equivalent");
                comparison = FormulaProvenance.Compare(emptyRecognizedCore, emptyRecognizedCore);
                Assert(comparison.Classification == "UNRELATED" && comparison.DerivativeCoreSheetCount == 1 && comparison.DerivativeValueCount == 0, "recognized but empty core sheet cannot be equivalent");
                comparison = FormulaProvenance.Compare(unresolved, origin);
                Assert(comparison.Classification == "UNRELATED" && comparison.DerivativeUnresolvedSharedFormulaCount == 1, "unresolved shared formula cannot look flattened");
                comparison = FormulaProvenance.Compare(shared2d, origin2d);
                Assert(comparison.Classification == "EXACT_EQUIVALENT" && comparison.DerivativeFormulaCount == 4, "two-dimensional shared formulas expand correctly");
                comparison = FormulaProvenance.Compare(stringFormulaA, stringFormulaB);
                Assert(comparison.Classification == "UNRELATED" && comparison.FormulaMismatches.Contains("원가계산서!A1"), "formula string literals are not uppercased or parsed as cell references");
                comparison = FormulaProvenance.Compare(missingCacheDerivative, missingCacheOrigin);
                Assert(comparison.Classification == "UNRELATED" && comparison.RemovedFormulaCellsWithoutCachedValue.Contains("원가계산서!A1"), "flattened formula requires a stored value on both sides");
                comparison = FormulaProvenance.Compare(arrayFormula, normalFormula);
                Assert(comparison.Classification == "UNRELATED" && comparison.DerivativeUnresolvedSharedFormulaCount == 1, "unsupported array formula metadata cannot pass provenance");
                comparison = FormulaProvenance.Compare(paddedSettingsA, paddedSettingsB);
                Assert(comparison.Classification == "UNRELATED" && comparison.DerivativeCoreSheetCount == 1 && comparison.FormulaMismatches.Contains(" 공사설정 !A1"), "actual padded settings sheet is included in provenance");
                comparison = FormulaProvenance.Compare(formulaCaseA, formulaCaseB);
                Assert(comparison.Classification == "EXACT_EQUIVALENT", "formula names and references are case insensitive outside string literals");
                comparison = FormulaProvenance.Compare(numericValue, booleanValue);
                Assert(comparison.Classification == "UNRELATED" && comparison.ValueMismatches.Contains("원가계산서!A1"), "stored value type participates in provenance equality");

                string qto = Path.Combine(directory, "qto.csv"), mapping = Path.Combine(directory, "mapping.csv"), manifest = Path.Combine(directory, "sources.csv");
                Csv.Write(qto, new[] { new[] { "q" } });
                Csv.Write(mapping, new[] { new[] { "m" } });
                WriteSourceManifest(manifest,
                    SourceRow("q1", "qto.csv", qto, "qto", "FORMULA", 1, "ACTIVE", ""),
                    SourceRow("e1", "origin.xlsx", origin, "estimate", "FORMULA", 1, "ACTIVE", ""),
                    SourceRow("e1-ref", "exact.xlsx", exact, "estimate", "FORMULA", 1, "REFERENCE", "e1"),
                    SourceRow("m1", "mapping.csv", mapping, "mapping", "FORMULA", 1, "ACTIVE", ""));
                SourceGateResult gate = SourceGate.Run(manifest, qto, origin, mapping);
                Assert(gate.Passed && gate.Findings.Any(x => x.Rule == "S005" && x.Status == "PASS"), "reference formula provenance gate");
                WriteSourceManifest(manifest,
                    SourceRow("q1", "qto.csv", qto, "qto", "FORMULA", 1, "ACTIVE", ""),
                    SourceRow("e1", "origin.xlsx", origin, "estimate", "FORMULA", 1, "ACTIVE", ""),
                    SourceRow("e1-ref", "exact.xlsx", exact, "estimate", "FORMULA", 1, "DERIVATIVE", "e1"),
                    SourceRow("m1", "mapping.csv", mapping, "mapping", "FORMULA", 1, "ACTIVE", ""));
                gate = SourceGate.Run(manifest, qto, origin, mapping);
                Assert(!gate.Passed && gate.Findings.Any(x => x.Rule == "S005" && x.Status == "FAIL"), "incorrect derivative declaration fails provenance gate");
            }
            finally { Directory.Delete(directory, true); }
        }

        private static void WriteFormulaWorkbook(string path, string rows, string sheetName = "원가계산서")
        {
            using (var archive = ZipFile.Open(path, ZipArchiveMode.Create))
            {
                Write(archive, "xl/workbook.xml", "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"" + sheetName + "\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
                Write(archive, "xl/_rels/workbook.xml.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\"/></Relationships>");
                Write(archive, "xl/worksheets/sheet1.xml", "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>" + rows + "</sheetData></worksheet>");
            }
        }

        private static void TestSourceGate()
        {
            string directory = Path.Combine(Path.GetTempPath(), "lukas-source-gate-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            string ifc = Path.Combine(directory, "model.ifc"), qto = Path.Combine(directory, "qto.csv"), estimate = Path.Combine(directory, "estimate.csv"), mapping = Path.Combine(directory, "mapping.csv"), manifest = Path.Combine(directory, "sources.csv");
            try
            {
                File.WriteAllText(ifc, "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
                Csv.Write(qto, new[] { new[] { "q" } });
                Csv.Write(estimate, new[] { new[] { "e" } });
                Csv.Write(mapping, new[] { new[] { "m" } });
                WriteSourceManifest(manifest,
                    SourceRow("q1", "qto.csv", qto, "qto", "A", 1, "ACTIVE", ""),
                    SourceRow("e1", "estimate.csv", estimate, "estimate", "A", 1, "ACTIVE", ""),
                    SourceRow("m1", "mapping.csv", mapping, "mapping", "A", 1, "ACTIVE", ""));
                SourceGateResult gate = SourceGate.RunWithHashes(manifest, qto, estimate, mapping, RunManifest.Hash(qto), RunManifest.Hash(estimate), RunManifest.Hash(mapping));
                Assert(gate.Passed && gate.SelectedScopeId == "A" && gate.Findings.Count == 5, "source gate valid flow");
                string runManifest = Path.Combine(directory, "run-manifest.csv");
                RunManifest.Write(runManifest, qto, estimate, mapping, new AuditPolicy(), RunManifest.Hash(qto), RunManifest.Hash(estimate), RunManifest.Hash(mapping), manifest, RunManifest.Hash(manifest), gate);
                var runRows = Csv.Read(runManifest);
                Assert(runRows.Any(x => x[0] == "소스게이트" && x[1] == "PASS") && runRows.Any(x => x[0] == "공사범위_ID" && x[1] == "A") && runRows.Any(x => x[0] == "ESTIMATE_소스_ID" && x[1] == "e1") && runRows.Any(x => x[0] == "소스_매니페스트_SHA256" && x[1].Length == 64), "run manifest binds source gate decision");
                bool immutable = false;
                try { ((IList<Finding>)gate.Findings).Clear(); } catch (NotSupportedException) { immutable = true; }
                Assert(immutable && gate.Passed, "source gate verdict cannot be mutated through findings");
                Assert(SourceGate.RunMappingTemplate(manifest, qto, estimate).Passed, "mapping template requires qto and estimate only");
                Assert(!SourceGate.Run(manifest, qto, estimate, null).Passed, "preflight requires mapping slot");

                WriteSourceManifest(manifest,
                    SourceRow("ifc1", "model.ifc", ifc, "ifc", "A", 1, "ACTIVE", ""),
                    SourceRow("q1", "qto.csv", qto, "qto", "A", 1, "ACTIVE", "ifc1"),
                    SourceRow("e1", "estimate.csv", estimate, "estimate", "A", 1, "ACTIVE", ""),
                    SourceRow("m1", "mapping.csv", mapping, "mapping", "A", 1, "ACTIVE", ""));
                gate = SourceGate.RunProject(manifest, ifc, qto, estimate, mapping);
                Assert(gate.Passed && gate.SelectedSourceIds["ifc"] == "ifc1" && gate.Findings.Any(x => x.Rule == "S006" && x.Status == "PASS"), "IFC project gate binds selected IFC to QTO provenance");
                RunManifest.Write(runManifest, qto, estimate, mapping, new AuditPolicy(), RunManifest.Hash(qto), RunManifest.Hash(estimate), RunManifest.Hash(mapping), manifest, RunManifest.Hash(manifest), gate, false, null, ifc, RunManifest.Hash(ifc));
                runRows = Csv.Read(runManifest);
                Assert(runRows.Any(x => x[0] == "IFC_SHA256" && x[1].Length == 64) && runRows.Any(x => x[0] == "IFC_소스_ID" && x[1] == "ifc1"), "run manifest records IFC identity and selected source");
                WriteSourceManifest(manifest,
                    SourceRow("ifc1", "model.ifc", ifc, "ifc", "A", 1, "ACTIVE", ""),
                    SourceRow("q1", "qto.csv", qto, "qto", "A", 1, "ACTIVE", ""),
                    SourceRow("e1", "estimate.csv", estimate, "estimate", "A", 1, "ACTIVE", ""),
                    SourceRow("m1", "mapping.csv", mapping, "mapping", "A", 1, "ACTIVE", ""));
                gate = SourceGate.RunProject(manifest, ifc, qto, estimate, mapping);
                Assert(!gate.Passed && gate.Findings.Any(x => x.Rule == "S006" && x.Status == "FAIL"), "IFC project gate rejects QTO without selected IFC provenance");
                string rogue = Path.Combine(directory, "rogue.csv");
                Csv.Write(rogue, new[] { new[] { "rogue" } });
                gate = SourceGate.RunWithHashes(manifest, rogue, estimate, mapping, RunManifest.Hash(qto), RunManifest.Hash(estimate), RunManifest.Hash(mapping));
                Assert(!gate.Passed && gate.Findings.Any(x => x.Rule == "S002" && x.Status == "FAIL"), "caller cannot forge a frozen selected-file hash");

                string reference = Path.Combine(directory, "estimate-reference.csv");
                Csv.Write(reference, new[] { new[] { "reference" } });
                WriteSourceManifest(manifest,
                    SourceRow("q1", "qto.csv", qto, "qto", "A", 1, "ACTIVE", ""),
                    SourceRow("e1", "estimate.csv", estimate, "estimate", "A", 1, "ACTIVE", ""),
                    SourceRow("e1-ref", "estimate-reference.csv", reference, "estimate", "A", 1, "REFERENCE", "e1"),
                    SourceRow("m1", "mapping.csv", mapping, "mapping", "A", 1, "ACTIVE", ""));
                gate = SourceGate.Run(manifest, qto, estimate, mapping);
                Assert(!gate.Passed && gate.Findings.Any(x => x.Rule == "S005" && x.Status == "FAIL"), "non-XLSX related provenance claim cannot pass");

                WriteSourceManifest(manifest,
                    SourceRow("q1", "qto.csv", qto, "qto", "A", 1, "ACTIVE", ""),
                    SourceRow("e1", "estimate.csv", estimate, "estimate", "B", 1, "ACTIVE", ""),
                    SourceRow("m1", "mapping.csv", mapping, "mapping", "A", 1, "ACTIVE", ""));
                gate = SourceGate.Run(manifest, qto, estimate, mapping);
                Assert(!gate.Passed && gate.Findings.Any(x => x.Rule == "S003" && x.Status == "FAIL"), "mixed scope blocked");

                string replacement = Path.Combine(directory, "estimate-r2.csv");
                Csv.Write(replacement, new[] { new[] { "e2" } });
                WriteSourceManifest(manifest,
                    SourceRow("q1", "qto.csv", qto, "qto", "A", 1, "ACTIVE", ""),
                    SourceRow("e1", "estimate.csv", estimate, "estimate", "A", 1, "SUPERSEDED", "e2"),
                    SourceRow("e2", "estimate-r2.csv", replacement, "estimate", "A", 2, "ACTIVE", ""),
                    SourceRow("m1", "mapping.csv", mapping, "mapping", "A", 1, "ACTIVE", ""));
                gate = SourceGate.Run(manifest, qto, estimate, mapping);
                Assert(!gate.Passed && gate.Findings.Any(x => x.Rule == "S004" && x.Status == "FAIL"), "superseded selection blocked");

                WriteSourceManifest(manifest,
                    SourceRow("q1", "qto.csv", qto, "qto", "A", 1, "ACTIVE", ""),
                    SourceRow("e1", "estimate.csv", estimate, "estimate", "A", 1, "ACTIVE", ""),
                    SourceRow("e2", "estimate-r2.csv", replacement, "estimate", "A", 2, "SUPERSEDED", "e1"),
                    SourceRow("m1", "mapping.csv", mapping, "mapping", "A", 1, "ACTIVE", ""));
                SourceManifestDocument revisions = SourceManifest.Read(manifest);
                Assert(revisions.RevisionErrors.Count > 0, "backward relation and older active rejected");

                string child = Path.Combine(directory, "child");
                Directory.CreateDirectory(child);
                string traversalManifest = Path.Combine(child, "sources.csv");
                WriteSourceManifest(traversalManifest, SourceRow("q1", "../qto.csv", qto, "qto", "A", 1, "ACTIVE", ""));
                Assert(SourceManifest.Read(traversalManifest).IntegrityErrors.Any(x => x.Contains("상위 폴더")), "manifest traversal rejected");

                WriteSourceManifest(manifest,
                    SourceRow("q1", "qto.csv", qto, "qto", "A", 1, "ACTIVE", ""),
                    SourceRow("e1", "estimate.csv", estimate, "estimate", "A", 1, "ACTIVE", ""),
                    SourceRow("m1", "mapping.csv", mapping, "mapping", "A", 1, "ACTIVE", ""));
                string realManifestDirectory = Path.Combine(directory, "real-manifest-directory");
                string linkedManifestDirectory = Path.Combine(directory, "linked-manifest-directory");
                Directory.CreateDirectory(realManifestDirectory);
                File.Copy(qto, Path.Combine(realManifestDirectory, "qto.csv"));
                WriteSourceManifest(Path.Combine(realManifestDirectory, "sources.csv"), SourceRow("q-linked", "qto.csv", Path.Combine(realManifestDirectory, "qto.csv"), "qto", "LINK", 1, "ACTIVE", ""));
                bool linkTested = false;
                try
                {
                    Directory.CreateSymbolicLink(linkedManifestDirectory, realManifestDirectory);
                    bool rejectedLink = false;
                    try { SourceManifest.Read(Path.Combine(linkedManifestDirectory, "sources.csv")); } catch (FormatException) { rejectedLink = true; }
                    Assert(rejectedLink, "manifest symlink directory rejected");
                    linkTested = true;
                }
                catch (UnauthorizedAccessException) { }
                catch (PlatformNotSupportedException) { }
                if (linkTested) Directory.Delete(linkedManifestDirectory);
                File.AppendAllText(qto, "changed");
                gate = SourceGate.Run(manifest, qto, estimate, mapping);
                Assert(!gate.Passed && gate.Findings.Any(x => x.Rule == "S001" && x.Status == "FAIL"), "source hash tamper blocked");
            }
            finally { Directory.Delete(directory, true); }
        }

        private static string[] SourceRow(string id, string relativePath, string filePath, string slot, string scope, int revision, string status, string related)
        {
            return new[] { id, relativePath, RunManifest.Hash(filePath).ToLowerInvariant(), slot, scope, revision.ToString(CultureInfo.InvariantCulture), status, related };
        }

        private static void WriteSourceManifest(string path, params string[][] rows)
        {
            Csv.Write(path, new[] { new[] { "source_id", "path", "sha256", "slot", "scope_id", "revision", "status", "related_source_id" } }.Concat(rows));
        }

        private static void TestRunManifest()
        {
            string input = Path.Combine(Path.GetTempPath(), "=thekie-manifest-input.csv");
            string manifest = Path.Combine(Path.GetTempPath(), "thekie-manifest.csv");
            try
            {
                Csv.Write(input, new[] { new[] { "A" } });
                RunManifest.Write(manifest, input, input, input, new AuditPolicy { QuantityTolerance = 0.01m, KrwTolerance = 500m }, sourceGateSkipped: true);
                var rows = Csv.Read(manifest);
                Assert(rows.Any(row => row[0] == "규칙버전" && row[1] == RunManifest.RulesetVersion) && rows.Any(row => row[0] == "엔진_코어_SHA256" && row[1].Length == 64) && rows.Any(row => row[0] == "QTO_SHA256" && row[1].Length == 64) && rows.Any(row => row[0] == "QTO_파일" && row[1] == "'=thekie-manifest-input.csv") && rows.Any(row => row[0] == "수량허용오차" && row[1] == "0.01") && rows.Any(row => row[0] == "KRW허용오차" && row[1] == "500") && rows.Any(row => row[0] == "소스게이트" && row[1] == "SKIPPED"), "run manifest hashes, engine identity, spreadsheet-safe filename, policy, and gate state");
            }
            finally
            {
                if (File.Exists(input)) File.Delete(input);
                if (File.Exists(manifest)) File.Delete(manifest);
            }
        }

        private static void TestHtmlReport()
        {
            string path = Path.Combine(Path.GetTempPath(), "thekie-report.html");
            try
            {
                Report.WriteHtml(path, new[] { new Finding { Rule = "R011", Status = "FAIL", Message = "A & B" } }, "report.manifest.csv");
                string html = File.ReadAllText(path);
                Assert(html.Contains("<table>") && html.Contains("R011") && html.Contains("A &amp; B") && html.Contains(RunManifest.RulesetVersion), "html report");
            }
            finally
            {
                if (File.Exists(path)) File.Delete(path);
            }
        }

        private static void TestReportPrecision()
        {
            string path = Path.Combine(Path.GetTempPath(), "thekie-report-precision.csv");
            try
            {
                Report.Write(path, new[] { new Finding { Rule = "R021", Status = "FAIL", LineId = "=1+1", Expected = 1.000001m, Actual = 1.000002m, Delta = -0.000001m } });
                var rows = Csv.Read(path);
                Assert(rows.Count == 2 && decimal.Parse(rows[1][6], CultureInfo.InvariantCulture) == 1.000001m &&
                    decimal.Parse(rows[1][7], CultureInfo.InvariantCulture) == 1.000002m &&
                    decimal.Parse(rows[1][8], CultureInfo.InvariantCulture) == -0.000001m && rows[1][3] == "'=1+1",
                    "report preserves full decimal audit precision: " + string.Join("|", rows.Count > 1 ? rows[1] : new string[0]));
            }
            finally { if (File.Exists(path)) File.Delete(path); }
        }

        private static void TestInvariantNumbers()
        {
            CultureInfo previous = CultureInfo.CurrentCulture;
            try
            {
                CultureInfo.CurrentCulture = new CultureInfo("fr-FR");
                Assert(Csv.Number("1,200.5", "값", 1) == 1200.5m, "invariant number parse");
                bool rejected = false;
                try { Csv.Number("1,5", "값", 1); } catch (FormatException) { rejected = true; }
                Assert(rejected, "locale decimal rejected");
            }
            finally
            {
                CultureInfo.CurrentCulture = previous;
            }
        }
    }
}
