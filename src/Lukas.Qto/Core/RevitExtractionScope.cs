using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Lukas.Qto.Compat;

namespace Lukas.Qto.Core
{
    // Scope is explicit because a Properties export must be reproducible from the
    // evidence file.  Host-document collectors do not traverse linked documents.
    public enum RevitExtractionScope { Selection, ActiveView, EntireHostModel }

    public sealed class RevitExtractionCounts
    {
        public int CandidateCount { get; internal set; }
        public int EligibleHostModelCount { get; internal set; }
        public int ExcludedLinkInstanceCount { get; internal set; }
        public int ExcludedNonModelCount { get; internal set; }
        public int ExcludedNonQuantityCount { get; internal set; }
        public int MissingSelectionIdCount { get; internal set; }
    }

    public static class RevitExtractionScopeReader
    {
        // Revit category display names are localized. Resolve the stable enum names
        // that exist in the installed Revit version and ignore absent version-specific
        // names. This intentionally excludes sketches, materials, legends, sheets,
        // cameras, project settings and other helper objects from quantity outputs.
        private static readonly HashSet<long> QuantityCategoryIds = BuildQuantityCategoryIds();

        public static List<Element> Collect(Document document, RevitExtractionScope scope, View activeView,
            IEnumerable<ElementId> selection, RevitExtractionCounts counts)
        {
            if (document == null) throw new ArgumentNullException("document");
            if (counts == null) throw new ArgumentNullException("counts");
            IEnumerable<Element> source;
            if (scope == RevitExtractionScope.Selection)
            {
                var selected = new List<Element>(); var seen = new HashSet<long>();
                foreach (ElementId id in selection ?? Enumerable.Empty<ElementId>())
                {
                    if (id == null || !seen.Add(RevitCompat.GetIdValue(id))) continue;
                    Element element = document.GetElement(id);
                    if (element == null) { counts.MissingSelectionIdCount++; continue; }
                    selected.Add(element);
                }
                source = selected;
            }
            else if (scope == RevitExtractionScope.ActiveView)
            {
                if (activeView == null) throw new InvalidOperationException("ActiveView 범위에는 활성 뷰가 필요합니다.");
                source = new FilteredElementCollector(document, activeView.Id).WhereElementIsNotElementType().WhereElementIsViewIndependent();
            }
            else if (scope == RevitExtractionScope.EntireHostModel)
                source = new FilteredElementCollector(document).WhereElementIsNotElementType().WhereElementIsViewIndependent();
            else throw new ArgumentOutOfRangeException("scope");

            var result = new List<Element>();
            foreach (Element element in source)
            {
                counts.CandidateCount++;
                if (element is RevitLinkInstance) { counts.ExcludedLinkInstanceCount++; continue; }
                Category category = element.Category;
                if (category == null || category.CategoryType != CategoryType.Model) { counts.ExcludedNonModelCount++; continue; }
                if (category.Id == null || !QuantityCategoryIds.Contains(RevitCompat.GetIdValue(category.Id)))
                {
                    counts.ExcludedNonQuantityCount++;
                    continue;
                }
                result.Add(element);
            }
            counts.EligibleHostModelCount = result.Count;
            return result;
        }

        private static HashSet<long> BuildQuantityCategoryIds()
        {
            string[] names =
            {
                "OST_Walls", "OST_Floors", "OST_Roofs", "OST_Ceilings", "OST_Doors", "OST_Windows",
                "OST_CurtainWallPanels", "OST_CurtainWallMullions", "OST_Columns", "OST_StructuralColumns",
                "OST_StructuralFraming", "OST_StructuralFoundation", "OST_StructuralStiffener", "OST_Truss",
                "OST_StructuralTruss", "OST_Rebar", "OST_GenericModel", "OST_Stairs", "OST_StairsRailing",
                "OST_Ramps", "OST_Furniture", "OST_Casework", "OST_SpecialityEquipment", "OST_PlumbingFixtures",
                "OST_MechanicalEquipment", "OST_ElectricalEquipment", "OST_ElectricalFixtures", "OST_LightingFixtures",
                "OST_LightingDevices", "OST_Sprinklers", "OST_DuctCurves", "OST_DuctFitting", "OST_DuctAccessory",
                "OST_FlexDuctCurves", "OST_PipeCurves", "OST_PipeFitting", "OST_PipeAccessory", "OST_FlexPipeCurves",
                "OST_CableTray", "OST_CableTrayFitting", "OST_Conduit", "OST_ConduitFitting", "OST_AirTerminals",
                "OST_FireAlarmDevices", "OST_DataDevices", "OST_CommunicationDevices", "OST_SecurityDevices",
                "OST_NurseCallDevices", "OST_TelephoneDevices", "OST_Parking", "OST_Planting"
            };
            var result = new HashSet<long>();
            foreach (string name in names)
            {
                object parsed;
                if (!Enum.TryParse(typeof(BuiltInCategory), name, false, out parsed)) continue;
                result.Add((int)(BuiltInCategory)parsed);
            }
            return result;
        }
    }
}
