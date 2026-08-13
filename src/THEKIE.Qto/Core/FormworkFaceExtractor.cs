using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using THEKIE.Qto.Compat;

namespace THEKIE.Qto.Core
{
    /// <summary>
    /// Reads Revit solid faces into an evidence ledger.  It intentionally does not
    /// classify concrete contact, soil, openings, or deductions; every extracted face
    /// remains REVIEW until a separately approved boundary policy supplies that fact.
    /// </summary>
    public static class FormworkFaceExtractor
    {
        private static readonly string[] Header = {
            "face_id", "element_id", "host_element_id", "member_type", "level", "category", "material_evidence",
            "face_area_m2", "orientation_evidence", "boundary_kind", "boundary_evidence_id", "decision", "review_reason"
        };

        public static List<FormworkFaceRow> Extract(Document document)
        {
            return Extract(document, null);
        }

        public static List<FormworkFaceRow> Extract(Document document, StructuralSourceEvidence source)
        {
            if (document == null) throw new ArgumentNullException("document");
            var output = new List<FormworkFaceRow>();
            var options = new Options { ComputeReferences = true, IncludeNonVisibleObjects = false, DetailLevel = ViewDetailLevel.Fine };
            foreach (Element element in new FilteredElementCollector(document).WhereElementIsNotElementType().WhereElementIsViewIndependent())
            {
                if (element == null || element.Category == null || element.Category.CategoryType != CategoryType.Model) continue;
                GeometryElement geometry;
                try { geometry = element.get_Geometry(options); }
                catch (Exception) { continue; }
                if (geometry == null) continue;
                string elementId = RevitCompat.GetIdValue(element.Id).ToString(CultureInfo.InvariantCulture);
                string category = element.Category.Name ?? "";
                string memberType = element.Name ?? "";
                int solidIndex = 0;
                foreach (Solid solid in Solids(geometry, 0))
                {
                    if (solid == null || solid.Faces == null || solid.Faces.Size == 0) { solidIndex++; continue; }
                    for (int faceIndex = 0; faceIndex < solid.Faces.Size; faceIndex++)
                    {
                        Face face = solid.Faces.get_Item(faceIndex);
                        if (face == null) continue;
                        double area = face.Area;
                        if (double.IsNaN(area) || double.IsInfinity(area) || area < 0d) continue;
                        double squareMeters = RevitCompat.ToSquareMeters(area);
                        if (double.IsNaN(squareMeters) || double.IsInfinity(squareMeters) || squareMeters < 0d) continue;
                        decimal decimalArea;
                        try { decimalArea = (decimal)squareMeters; }
                        catch (OverflowException) { continue; }
                        string faceId = FaceId(document, face, elementId, solidIndex, faceIndex);
                        output.Add(new FormworkFaceRow {
                            FaceId = faceId,
                            ElementId = elementId,
                            HostElementId = elementId,
                            MemberType = memberType,
                            Category = category,
                            Level = LevelName(document, element),
                            MaterialEvidence = "UNRESOLVED: face material was not inferred",
                            OrientationEvidence = "UNRESOLVED: face orientation was not classified",
                            AreaBasis = FormworkAreaBasis.Gross,
                            FaceAreaM2 = decimalArea,
                            OpeningUnionAreaM2 = 0m,
                            BoundaryKind = FormworkBoundaryKind.Unknown,
                            BoundaryEvidenceId = "face=" + faceId + ";boundary=UNRESOLVED;opening=UNRESOLVED",
                            Decision = FormworkDecision.Review,
                            ReviewReason = "Concrete contact, opening union, deduction, orientation, and material applicability require an approved face policy.",
                            Source = source
                        });
                    }
                    solidIndex++;
                }
            }
            List<FormworkFaceRow> ordered = output.OrderBy(row => row.ElementId, StringComparer.Ordinal).ThenBy(row => row.FaceId, StringComparer.Ordinal).ToList();
            string ledgerHash = FormworkTakeoff.ComputeLedgerHash(ordered);
            foreach (FormworkFaceRow row in ordered) row.GeometryLedgerSha256 = ledgerHash;
            return ordered;
        }

        public static void WriteLedger(string path, IEnumerable<FormworkFaceRow> rows)
        {
            if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("formwork face ledger path is required.", "path");
            if (rows == null) throw new ArgumentNullException("rows");
            string fullPath = Path.GetFullPath(path);
            if (File.Exists(fullPath) || Directory.Exists(fullPath)) throw new IOException("기존 거푸집 face 원장을 덮어쓰지 않습니다.");
            string parent = Path.GetDirectoryName(fullPath);
            if (string.IsNullOrWhiteSpace(parent) || !Directory.Exists(parent)) throw new IOException("거푸집 face 원장 상위 폴더가 없습니다.");
            List<FormworkFaceRow> checkedRows = rows.ToList();
            if (checkedRows.Any(row => row == null || string.IsNullOrWhiteSpace(row.FaceId) || string.IsNullOrWhiteSpace(row.ElementId)))
                throw new InvalidDataException("거푸집 face 원장의 face_id와 element_id가 필요합니다.");
            if (checkedRows.GroupBy(row => row.FaceId, StringComparer.Ordinal).Any(group => group.Count() != 1))
                throw new InvalidDataException("거푸집 face_id가 중복됩니다.");
            var csvRows = new List<string[]> { Header };
            foreach (FormworkFaceRow row in checkedRows)
                csvRows.Add(new[] { row.FaceId, row.ElementId, row.HostElementId, row.MemberType, row.Level, row.Category, row.MaterialEvidence,
                    row.FaceAreaM2.ToString(CultureInfo.InvariantCulture), row.OrientationEvidence, row.BoundaryKind.ToString(), row.BoundaryEvidenceId,
                    row.Decision.ToString(), row.ReviewReason }.Select(Csv.SpreadsheetText).ToArray());
            Csv.Write(fullPath, csvRows);
        }

        private static IEnumerable<Solid> Solids(GeometryElement geometry, int depth)
        {
            if (depth > 8) yield break;
            foreach (GeometryObject item in geometry)
            {
                Solid solid = item as Solid;
                if (solid != null) { yield return solid; continue; }
                GeometryInstance instance = item as GeometryInstance;
                if (instance == null) continue;
                GeometryElement nested;
                try { nested = instance.GetInstanceGeometry(); }
                catch (Exception) { continue; }
                if (nested == null) continue;
                foreach (Solid nestedSolid in Solids(nested, depth + 1)) yield return nestedSolid;
            }
        }

        private static string FaceId(Document document, Face face, string elementId, int solidIndex, int faceIndex)
        {
            try
            {
                if (face.Reference != null)
                {
                    string stable = face.Reference.ConvertToStableRepresentation(document);
                    if (!string.IsNullOrWhiteSpace(stable)) return stable;
                }
            }
            catch (Exception) { }
            return "element=" + elementId + ";solid=" + solidIndex.ToString(CultureInfo.InvariantCulture) + ";face=" + faceIndex.ToString(CultureInfo.InvariantCulture);
        }

        private static string LevelName(Document document, Element element)
        {
            if (element.LevelId == null || element.LevelId == ElementId.InvalidElementId) return "";
            Element level = document.GetElement(element.LevelId);
            return level == null ? "" : level.Name ?? "";
        }
    }
}
