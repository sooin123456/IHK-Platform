using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using THEKIE.Qto.Compat;

namespace THEKIE.Qto.Core
{
    /// <summary>모델 요소별 원시 Properties만 추출하며 재료·규격·누락값은 추측하지 않는다.</summary>
    public static class ElementQuantityExtractor
    {
        private static readonly BuiltInParameter[] VolumeParameters = {
            BuiltInParameter.HOST_VOLUME_COMPUTED
        };
        private static readonly BuiltInParameter[] LengthParameters = {
            BuiltInParameter.CURVE_ELEM_LENGTH,
            BuiltInParameter.INSTANCE_LENGTH_PARAM
        };
        // Height is intentionally conservative for the first release. A wall's
        // unconnected height is a documented built-in parameter; other element
        // classes stay MISSING until their parameter semantics are field-tested.
        private static readonly BuiltInParameter[] HeightParameters = {
            BuiltInParameter.WALL_USER_HEIGHT_PARAM
        };

        public static List<ElementQuantityLedgerRow> Extract(Document document)
        {
            return Extract(document, RevitExtractionScope.EntireHostModel, null, null, null);
        }

        public static List<ElementQuantityLedgerRow> Extract(Document document, RevitExtractionScope scope, View activeView,
            IEnumerable<ElementId> selection, RevitExtractionCounts counts)
        {
            if (document == null) throw new ArgumentNullException("document");
            if (counts == null) counts = new RevitExtractionCounts();
            var rows = new List<ElementQuantityLedgerRow>();
            foreach (Element element in RevitExtractionScopeReader.Collect(document, scope, activeView, selection, counts))
            {
                Category category = element.Category;
                ElementType type = document.GetElement(element.GetTypeId()) as ElementType;
                var row = new ElementQuantityLedgerRow {
                    ElementId = ElementQuantityLedger.CanonicalElementId(RevitCompat.GetIdValue(element.Id).ToString(System.Globalization.CultureInfo.InvariantCulture)),
                    Category = category.Name ?? "", Family = type == null ? "" : type.FamilyName ?? "",
                    Type = type == null ? element.Name ?? "" : type.Name ?? "", ElementName = element.Name ?? "", Level = LevelName(document, element),
                    VolumeState = ElementVolumeState.MISSING
                };
                ReadVolume(element, row);
                ReadLength(element, row);
                ReadHeight(element, row);
                rows.Add(row);
            }
            return rows;
        }

        private static void ReadVolume(Element element, ElementQuantityLedgerRow row)
        {
            ElementVolumeState state; decimal? value; string source;
            ReadMeasurement(element, row, VolumeParameters, "체적", RevitCompat.ToCubicMeters, out state, out value, out source);
            row.VolumeState = state; row.VolumeM3 = value; row.SourceParameter = source;
        }

        private static void ReadLength(Element element, ElementQuantityLedgerRow row)
        {
            ElementVolumeState state; decimal? value; string source;
            ReadMeasurement(element, row, LengthParameters, "길이", RevitCompat.ToMeters, out state, out value, out source);
            row.LengthState = state; row.LengthM = value; row.LengthSourceParameter = source;
        }

        private static void ReadHeight(Element element, ElementQuantityLedgerRow row)
        {
            ElementVolumeState state; decimal? value; string source;
            ReadMeasurement(element, row, HeightParameters, "높이", RevitCompat.ToMeters, out state, out value, out source);
            row.HeightState = state; row.HeightM = value; row.HeightSourceParameter = source;
        }

        private static void ReadMeasurement(Element element, ElementQuantityLedgerRow row, BuiltInParameter[] candidates,
            string label, Func<double, double> convert, out ElementVolumeState state, out decimal? value, out string source)
        {
            state = ElementVolumeState.MISSING;
            value = null;
            source = null;
            foreach (BuiltInParameter candidate in candidates)
            {
                Parameter parameter = element.get_Parameter(candidate);
                if (parameter == null || !parameter.HasValue || parameter.StorageType != StorageType.Double) continue;
                double internalValue = parameter.AsDouble();
                if (double.IsNaN(internalValue) || double.IsInfinity(internalValue) || internalValue < 0d)
                    throw new InvalidOperationException("요소 " + row.ElementId + "의 " + candidate + " " + label + "값이 유효하지 않습니다.");
                double converted = convert(internalValue);
                if (double.IsNaN(converted) || double.IsInfinity(converted) || converted < 0d)
                    throw new InvalidOperationException("요소 " + row.ElementId + "의 " + candidate + " 변환 " + label + "값이 유효하지 않습니다.");
                try { value = (decimal)converted; }
                catch (OverflowException) { throw new InvalidOperationException("요소 " + row.ElementId + "의 " + candidate + " 변환 " + label + "값이 decimal 범위를 벗어납니다."); }
                source = candidate.ToString();
                state = converted == 0d ? ElementVolumeState.ZERO : ElementVolumeState.COMPUTED;
                return;
            }
        }

        private static string LevelName(Document document, Element element)
        {
            if (element.LevelId == null || element.LevelId == ElementId.InvalidElementId) return "";
            Element level = document.GetElement(element.LevelId);
            return level == null ? "" : level.Name ?? "";
        }
    }
}
