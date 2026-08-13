using Autodesk.Revit.DB;

namespace Autodesk.Revit.UI
{
    public enum Result { Succeeded, Failed, Cancelled }
    public enum ItemSelectionDialogResult { Confirmed, Canceled }
    public enum TaskDialogCommonButtons { Close }
    public interface IExternalApplication { Result OnStartup(UIControlledApplication application); Result OnShutdown(UIControlledApplication application); }
    public interface IExternalCommand { Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements); }
    public class UIControlledApplication { public void CreateRibbonTab(string name) { } public RibbonPanel CreateRibbonPanel(string tab, string panel) { return new RibbonPanel(); } }
    public class RibbonPanel { public object AddItem(PushButtonData data) { return null; } }
    public class PushButtonData { public PushButtonData(string name, string text, string assembly, string className) { } public string ToolTip { get; set; } public string LongDescription { get; set; } }
    public class UIDocument { public Document Document { get; set; } public View ActiveView { get; set; } public Autodesk.Revit.UI.Selection.Selection Selection { get; } = new Autodesk.Revit.UI.Selection.Selection(); }
    public class UIApplication { public UIDocument ActiveUIDocument { get; set; } public Autodesk.Revit.ApplicationServices.Application Application { get; set; } = new Autodesk.Revit.ApplicationServices.Application(); }
    public class ExternalCommandData { public UIApplication Application { get; set; } }
    public class FileSaveDialog
    {
        public static ItemSelectionDialogResult NextResult { get; set; } = ItemSelectionDialogResult.Confirmed;
        public static string NextPath { get; set; }
        public FileSaveDialog(string filter) { }
        public string Title { get; set; }
        public string InitialFileName { get; set; }
        public ItemSelectionDialogResult Show() { return NextResult; }
        public ModelPath GetSelectedModelPath() { return new ModelPath { Path = NextPath }; }
    }
    public enum TaskDialogCommandLinkId { CommandLink1, CommandLink2, CommandLink3 }
    public enum TaskDialogResult { None, Cancel, CommandLink1, CommandLink2, CommandLink3 }
    public class TaskDialog { public static TaskDialogResult NextResult { get; set; } = TaskDialogResult.CommandLink3; public TaskDialog(string title) { } public string MainInstruction { get; set; } public string MainContent { get; set; } public TaskDialogCommonButtons CommonButtons { get; set; } public void AddCommandLink(TaskDialogCommandLinkId id, string mainInstruction, string supportingContent) { } public TaskDialogResult Show() { return NextResult; } public static void Show(string title, string message) { } }
}

namespace Autodesk.Revit.UI.Selection
{
    public sealed class Selection
    {
        private readonly System.Collections.Generic.List<Autodesk.Revit.DB.ElementId> _ids = new System.Collections.Generic.List<Autodesk.Revit.DB.ElementId>();
        public System.Collections.Generic.ICollection<Autodesk.Revit.DB.ElementId> GetElementIds() { return _ids.AsReadOnly(); }
        public void SetElementIds(System.Collections.Generic.IEnumerable<Autodesk.Revit.DB.ElementId> ids) { _ids.Clear(); if (ids != null) _ids.AddRange(ids); }
    }
}
