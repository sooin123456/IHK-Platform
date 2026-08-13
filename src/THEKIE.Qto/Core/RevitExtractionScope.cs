using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using THEKIE.Qto.Compat;

namespace THEKIE.Qto.Core
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
        public int MissingSelectionIdCount { get; internal set; }
    }

    public static class RevitExtractionScopeReader
    {
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
                result.Add(element);
            }
            counts.EligibleHostModelCount = result.Count;
            return result;
        }
    }
}
