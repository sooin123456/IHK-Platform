using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;

namespace Autodesk.Revit.Attributes
{
    public enum TransactionMode { ReadOnly, Manual }
    public enum RegenerationOption { Manual }
    public sealed class TransactionAttribute : Attribute { public TransactionAttribute(TransactionMode value) { } }
    public sealed class RegenerationAttribute : Attribute { public RegenerationAttribute(RegenerationOption value) { } }
}

namespace Autodesk.Revit.DB
{
    public enum CategoryType { Model }
    public enum StorageType { Double }
    public enum BuiltInParameter {
        HOST_VOLUME_COMPUTED, HOST_AREA_COMPUTED,
        CURVE_ELEM_LENGTH, INSTANCE_LENGTH_PARAM, WALL_USER_HEIGHT_PARAM
    }
#if !REVIT2017
    public sealed class ForgeTypeId { }
    public static class UnitTypeId { public static ForgeTypeId CubicMeters { get; } = new ForgeTypeId(); public static ForgeTypeId SquareMeters { get; } = new ForgeTypeId(); public static ForgeTypeId Meters { get; } = new ForgeTypeId(); }
#endif
    public enum DisplayUnitType { DUT_CUBIC_METERS, DUT_SQUARE_METERS, DUT_METERS }
    public static class UnitUtils
    {
#if !REVIT2017
        public static double ConvertFromInternalUnits(double value, ForgeTypeId unit) { return value; }
#endif
        public static double ConvertFromInternalUnits(double value, DisplayUnitType unit) { return value; }
    }
    public class ElementId { public static ElementId InvalidElementId { get; } = new ElementId(); public int IntegerValue { get; set; } public long Value { get; set; } }
    public class Parameter { public bool HasValue { get; set; } public StorageType StorageType { get; set; } public double Value { get; set; } public double AsDouble() { return Value; } }
    public class Category { public string Name { get; set; } public CategoryType CategoryType { get; set; } }
    public enum ViewDetailLevel { Fine }
    public sealed class Options { public bool ComputeReferences { get; set; } public bool IncludeNonVisibleObjects { get; set; } public ViewDetailLevel DetailLevel { get; set; } }
    public abstract class GeometryObject { }
    public sealed class Reference { public string StableRepresentation { get; set; } public string ConvertToStableRepresentation(Document document) { return StableRepresentation; } }
    public sealed class Face { public double Area { get; set; } public Reference Reference { get; set; } }
    public sealed class FaceArray { private readonly List<Face> items = new List<Face>(); public int Size { get { return items.Count; } } public Face get_Item(int index) { return items[index]; } public void Add(Face face) { items.Add(face); } }
    public sealed class Solid : GeometryObject { public FaceArray Faces { get; } = new FaceArray(); }
    public sealed class GeometryElement : IEnumerable<GeometryObject> { private readonly List<GeometryObject> items = new List<GeometryObject>(); public void Add(GeometryObject item) { items.Add(item); } public IEnumerator<GeometryObject> GetEnumerator() { return items.GetEnumerator(); } IEnumerator IEnumerable.GetEnumerator() { return GetEnumerator(); } }
    public sealed class GeometryInstance : GeometryObject { public GeometryElement InstanceGeometry { get; set; } public GeometryElement GetInstanceGeometry() { return InstanceGeometry; } }
    public class Element { private readonly Dictionary<BuiltInParameter, Parameter> _parameters = new Dictionary<BuiltInParameter, Parameter>(); public Category Category { get; set; } public ElementId Id { get; set; } public ElementId LevelId { get; set; } public string Name { get; set; } public ElementId TypeId { get; set; } public GeometryElement Geometry { get; set; } public ElementId GetTypeId() { return TypeId; } public GeometryElement get_Geometry(Options options) { return Geometry; } public Parameter get_Parameter(BuiltInParameter parameter) { Parameter value; return _parameters.TryGetValue(parameter, out value) ? value : null; } public void SetParameter(BuiltInParameter parameter, Parameter value) { _parameters[parameter] = value; } }
    public class ElementType : Element { public string FamilyName { get; set; } }
    public class RevitLinkInstance : Element { }
    public class View : Element { }
    public sealed class ModelPath { public string Path { get; set; } }
    public static class ModelPathUtils { public static string ConvertModelPathToUserVisiblePath(ModelPath path) { return path.Path; } }
    public sealed class IFCExportOptions : IDisposable { public void Dispose() { } }
    public enum TransactionStatus { Started, Committed, RolledBack }
    public sealed class Transaction : IDisposable
    {
        private readonly Document _document;
        public Transaction(Document document, string name) { _document = document; }
        public TransactionStatus Start() { _document.IsModifiable = true; return TransactionStatus.Started; }
        public TransactionStatus Commit() { _document.IsModifiable = false; return TransactionStatus.Committed; }
        public TransactionStatus RollBack() { _document.IsModifiable = false; return TransactionStatus.RolledBack; }
        public void Dispose() { _document.IsModifiable = false; }
    }
    public class Document
    {
        private readonly Dictionary<ElementId, Element> _elements = new Dictionary<ElementId, Element>();
        public string Title { get; set; }
        public bool IsModifiable { get; internal set; }
        public string LastExportFolder { get; private set; }
        public string LastExportName { get; private set; }
        public bool ExportResult { get; set; } = true;
        public bool ThrowOnElements { get; set; }
        public string ElementsExceptionMessage { get; set; } = "stub QTO failure";
        public string IfcContent { get; set; } = "ISO-10303-21; stub IFC";
        public IEnumerable<Element> Elements { get { return _elements.Values; } }
        public Element GetElement(ElementId id) { Element value; return id != null && _elements.TryGetValue(id, out value) ? value : null; }
        public void Add(Element element) { _elements[element.Id] = element; }
        public bool Export(string folder, string name, IFCExportOptions options)
        {
            if (!IsModifiable) throw new InvalidOperationException("IFC export requires a transaction.");
            LastExportFolder = folder;
            LastExportName = name;
            if (!ExportResult) return false;
            File.WriteAllText(Path.Combine(folder, name), IfcContent);
            return true;
        }
    }
    public class FilteredElementCollector : IEnumerable<Element> { private readonly Document _document; public FilteredElementCollector(Document document) { _document = document; } public FilteredElementCollector(Document document, ElementId viewId) { _document = document; } public FilteredElementCollector WhereElementIsNotElementType() { return this; } public FilteredElementCollector WhereElementIsViewIndependent() { return this; } public IEnumerator<Element> GetEnumerator() { if (_document.ThrowOnElements) throw new InvalidOperationException(_document.ElementsExceptionMessage); return _document.Elements.GetEnumerator(); } IEnumerator IEnumerable.GetEnumerator() { return GetEnumerator(); } }
    public class ElementSet : IEnumerable<Element> { public IEnumerator<Element> GetEnumerator() { return new List<Element>().GetEnumerator(); } IEnumerator IEnumerable.GetEnumerator() { return GetEnumerator(); } }
}

namespace Autodesk.Revit.ApplicationServices
{
    public class Application { public string VersionNumber { get; set; } = "2026"; public string VersionBuild { get; set; } = "stub-build"; }
}

namespace Autodesk.Revit.Exceptions
{
    public class ArgumentException : System.ArgumentException { }
}
