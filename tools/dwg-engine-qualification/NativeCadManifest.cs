using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DwgEngineQualification;

internal readonly record struct CadPoint(double X, double Y);
internal sealed record NativeScope(string ProjectId, string DocumentId, string RevisionId, long OperationSequence, string StructureSha256);
internal sealed record NativeOutputProfile(string Paper, string Orientation, double Width, double Height, double ScaleDenominator);
internal sealed record NativeViewport(CadPoint PaperCenter, CadPoint ViewCenter, double ViewHeight, double Scale);
internal sealed record NativeCanvas(string Id, string PageId, string Name, double ModelWidth, double ModelHeight, NativeOutputProfile OutputProfile, NativeViewport Viewport);
internal sealed record NativeLayer(string Id, string Name, bool Visible, bool Locked, string SystemKind, string CanvasId, int SortOrder, int Version, string CadName);
internal sealed record NativeStyle(bool IsBlockDefined, string? Stroke, double StrokeWidth, string? Fill, double? FontSize, double RequestedPaperLineweight);
internal abstract record NativeGeometry(string Type);
internal sealed record NativeLine(CadPoint Start, CadPoint End) : NativeGeometry("line");
internal sealed record NativePolyline(IReadOnlyList<CadPoint> Points, bool Closed) : NativeGeometry("polyline");
internal sealed record NativeCircle(CadPoint Center, double Radius) : NativeGeometry("circle");
internal sealed record NativeArc(CadPoint Center, double Radius, double StartAngleDegrees, double EndAngleDegrees) : NativeGeometry("arc");
internal sealed record NativeText(CadPoint Origin, string Text, double Width, double FontSize, double LineHeight, string Attachment, string Wrapping, double RotationDegrees) : NativeGeometry("text");
internal sealed record NativeDimension(CadPoint Start, CadPoint End, CadPoint DimensionLinePoint, CadPoint TextPosition, double FontSize, int Precision, string Suffix, double Measurement) : NativeGeometry("dimension");
internal sealed record NativeHatch(IReadOnlyList<CadPoint>? Polygon, CadPoint? CircleCenter, double? CircleRadius, string Color, double Opacity) : NativeGeometry("hatch");
internal sealed record NativeInsert(string BlockId, CadPoint Origin, double RotationDegrees, double ScaleX, double ScaleY) : NativeGeometry("insert");
internal sealed record NativeEntity(string Id, string? LayerId, NativeStyle Style, NativeGeometry Geometry);
internal sealed record NativePrimitive(string LocalId, string Name, IReadOnlyList<string> EntityIds);
internal sealed record NativeBlock(string Id, string Name, int Version, string CadName, IReadOnlyList<NativePrimitive> Primitives, IReadOnlyList<NativeEntity> Entities);
internal sealed record NativeLineage(string Id, string Kind, string Name, int Version, IReadOnlyList<string> EntityIds, string? Representation);

internal sealed class NativeCadManifest : IDisposable
{
    private readonly record struct NativeExtents(double MinX, double MinY, double MaxX, double MaxY);
    private const long MaximumBytes = 20L * 1024 * 1024;
    private const int MaximumNodes = 1_000_000;
    private const int MaximumPoints = 100_000;
    private const double MaximumCoordinate = 999_999_999_999;
    private static readonly Regex UuidPattern = new("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex ShaPattern = new("^[0-9a-f]{64}$", RegexOptions.CultureInvariant);
    private static readonly Regex RgbPattern = new("^#[0-9a-f]{6}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex RgbaPattern = new("^#[0-9a-f]{6}(?:[0-9a-f]{2})?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private readonly JsonDocument _document;

    public byte[] SourceBytes { get; }
    public string SourceFileName { get; }
    public string SourceSha256 { get; }
    public NativeScope Scope { get; }
    public NativeCanvas Canvas { get; }
    public IReadOnlyList<NativeLayer> Layers { get; }
    public IReadOnlyList<NativeBlock> Blocks { get; }
    public IReadOnlyList<NativeEntity> Entities { get; }
    public IReadOnlyList<NativeLineage> Lineage { get; }

    private NativeCadManifest(
        JsonDocument document,
        byte[] sourceBytes,
        string sourceFileName,
        NativeScope scope,
        NativeCanvas canvas,
        IReadOnlyList<NativeLayer> layers,
        IReadOnlyList<NativeBlock> blocks,
        IReadOnlyList<NativeEntity> entities,
        IReadOnlyList<NativeLineage> lineage)
    {
        _document = document;
        SourceBytes = sourceBytes;
        SourceFileName = sourceFileName;
        SourceSha256 = Convert.ToHexString(SHA256.HashData(sourceBytes)).ToLowerInvariant();
        Scope = scope;
        Canvas = canvas;
        Layers = layers;
        Blocks = blocks;
        Entities = entities;
        Lineage = lineage;
    }

    public static NativeCadManifest Load(string inputPath)
    {
        if (string.IsNullOrWhiteSpace(inputPath)) throw new ArgumentException("Input path is required.");
        var info = new FileInfo(inputPath);
        if (!info.Exists) throw new FileNotFoundException("Input manifest does not exist.", inputPath);
        if (info.Length > MaximumBytes) throw new InvalidDataException("CAD manifest exceeds 20 MiB.");

        byte[] bytes;
        using (var stream = new FileStream(info.FullName, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, FileOptions.SequentialScan))
        {
            bytes = new byte[checked((int)stream.Length)];
            stream.ReadExactly(bytes);
        }
        _ = new UTF8Encoding(false, true).GetString(bytes);

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(bytes, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 64,
            });
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("CAD manifest is malformed JSON.", exception);
        }

        try
        {
            ValidateRawJson(document.RootElement);
            var root = Object(document.RootElement,
                ["schemaVersion", "qualification", "units", "coordinateSystem", "targetVersion", "scope", "canvas", "layers", "blocks", "entities", "lineage", "metadata", "policies"]);
            Literal(root, "schemaVersion", "1hk-native-cad/1");
            Literal(root, "qualification", "experimental-unqualified");
            Literal(root, "units", "mm");
            Literal(root, "coordinateSystem", "WCS_X_RIGHT_Y_UP");
            Literal(root, "targetVersion", "AC1024");
            var scope = ParseScope(root.GetProperty("scope"));
            var canvas = ParseCanvas(root.GetProperty("canvas"));
            var layers = Array(root.GetProperty("layers"), 100_000).Select(ParseLayer).ToArray();
            var pointCount = 0;
            var blocks = Array(root.GetProperty("blocks"), 1_000).Select(value => ParseBlock(value, ref pointCount)).ToArray();
            var entities = Array(root.GetProperty("entities"), 100_000).Select(value => ParseEntity(value, ref pointCount)).ToArray();
            if (entities.Length + blocks.Sum(block => block.Entities.Count) > 100_000) throw new InvalidDataException("CAD emitted entity budget exceeded.");
            var lineage = Array(root.GetProperty("lineage"), 10_000).Select(ParseLineage).ToArray();
            ParseMetadata(root.GetProperty("metadata"), scope, canvas, layers, blocks, lineage);
            ParsePolicies(root.GetProperty("policies"));
            ValidateReferences(scope, canvas, layers, blocks, entities, lineage);
            return new NativeCadManifest(document, bytes, Path.GetFileName(info.FullName), scope, canvas, layers, blocks, entities, lineage);
        }
        catch
        {
            document.Dispose();
            throw;
        }
    }

    public void Dispose() => _document.Dispose();

    private static NativeScope ParseScope(JsonElement value)
    {
        var item = Object(value, ["projectId", "documentId", "revisionId", "operationSequence", "structureSha256"]);
        return new NativeScope(
            Uuid(item, "projectId"), Uuid(item, "documentId"), Uuid(item, "revisionId"),
            Integer64(item, "operationSequence", 0, 9_007_199_254_740_991),
            Match(item, "structureSha256", ShaPattern, "lowercase SHA-256"));
    }

    private static NativeCanvas ParseCanvas(JsonElement value)
    {
        var item = Object(value, ["id", "pageId", "name", "modelWidthMillimeters", "modelHeightMillimeters", "outputProfile", "viewport"]);
        var canvas = new NativeCanvas(
            Uuid(item, "id"), Uuid(item, "pageId"), Name(item, "name"),
            Positive(item, "modelWidthMillimeters"), Positive(item, "modelHeightMillimeters"),
            ParseOutputProfile(item.GetProperty("outputProfile")), ParseViewport(item.GetProperty("viewport")));
        var profile = canvas.OutputProfile;
        var viewport = canvas.Viewport;
        Equal(Derived(profile.Width / 2, "profile paper center X"), viewport.PaperCenter.X, "Viewport paper center X does not match profile.");
        Equal(Derived(profile.Height / 2, "profile paper center Y"), viewport.PaperCenter.Y, "Viewport paper center Y does not match profile.");
        Equal(Derived(canvas.ModelWidth / 2, "canvas view center X"), viewport.ViewCenter.X, "Viewport model center X does not match canvas.");
        Equal(Derived(-canvas.ModelHeight / 2, "canvas view center Y"), viewport.ViewCenter.Y, "Viewport model center Y does not match canvas.");
        Equal(canvas.ModelHeight, viewport.ViewHeight, "Viewport height does not match canvas.");
        Equal(Derived(1 / profile.ScaleDenominator, "output scale"), viewport.Scale, "Viewport scale does not match profile.");
        Equal(viewport.Scale, Derived(profile.Width / canvas.ModelWidth, "paper width scale"), "Paper width does not match viewport scale.");
        Equal(viewport.Scale, Derived(profile.Height / canvas.ModelHeight, "paper height scale"), "Paper height does not match viewport scale.");
        return canvas;
    }

    private static NativeOutputProfile ParseOutputProfile(JsonElement value)
    {
        var item = Object(value, ["paper", "orientation", "widthMillimeters", "heightMillimeters", "scaleDenominator"]);
        var orientation = String(item, "orientation");
        if (orientation is not ("portrait" or "landscape")) throw new InvalidDataException("Output profile orientation is invalid.");
        var result = new NativeOutputProfile(Name(item, "paper"), orientation, Positive(item, "widthMillimeters"), Positive(item, "heightMillimeters"), Positive(item, "scaleDenominator"));
        if ((orientation == "landscape" && result.Width <= result.Height) || (orientation == "portrait" && result.Height <= result.Width))
            throw new InvalidDataException("Output profile orientation and dimensions do not agree.");
        return result;
    }

    private static NativeViewport ParseViewport(JsonElement value)
    {
        var item = Object(value, ["paperCenter", "viewCenter", "viewHeight", "scale"]);
        return new NativeViewport(Point(item.GetProperty("paperCenter")), Point(item.GetProperty("viewCenter")), Positive(item, "viewHeight"), Positive(item, "scale"));
    }

    private static NativeLayer ParseLayer(JsonElement value)
    {
        var item = Object(value, ["id", "name", "visible", "locked", "systemKind", "canvasId", "sortOrder", "version", "cadName"]);
        var id = Uuid(item, "id");
        var systemKind = String(item, "systemKind");
        if (systemKind is not ("source" or "work" or "custom")) throw new InvalidDataException("Layer systemKind is invalid.");
        var visible = Boolean(item, "visible");
        var locked = Boolean(item, "locked");
        if (systemKind == "source" && (!visible || !locked)) throw new InvalidDataException("Source layers must be visible and locked.");
        var cadName = String(item, "cadName");
        if (cadName != $"L_{id.Replace("-", string.Empty, StringComparison.Ordinal).ToLowerInvariant()}") throw new InvalidDataException("Layer CAD name does not match its UUID.");
        return new NativeLayer(id, Name(item, "name"), visible, locked, systemKind, Uuid(item, "canvasId"), Integer(item, "sortOrder", 0), Integer(item, "version", 1), cadName);
    }

    private static NativeBlock ParseBlock(JsonElement value, ref int pointCount)
    {
        var item = Object(value, ["id", "name", "version", "cadName", "primitives", "entities"]);
        var id = Uuid(item, "id");
        var cadName = String(item, "cadName");
        if (cadName != $"B_{id.Replace("-", string.Empty, StringComparison.Ordinal).ToLowerInvariant()}") throw new InvalidDataException("Block CAD name does not match its UUID.");
        var primitives = Array(item.GetProperty("primitives"), 100_000).Select(ParsePrimitive).ToArray();
        if (primitives.Select(primitive => primitive.LocalId).Distinct(StringComparer.Ordinal).Count() != primitives.Length) throw new InvalidDataException("Duplicate block primitive identity.");
        var entities = new List<NativeEntity>();
        foreach (var entity in Array(item.GetProperty("entities"), 100_000)) entities.Add(ParseEntity(entity, ref pointCount));
        return new NativeBlock(id, Name(item, "name"), Integer(item, "version", 1), cadName, primitives, entities);
    }

    private static NativePrimitive ParsePrimitive(JsonElement value)
    {
        var item = Object(value, ["localId", "name", "entityIds"]);
        var ids = Array(item.GetProperty("entityIds"), 100_000).Select(EntityId).ToArray();
        if (ids.Length == 0) throw new InvalidDataException("Block primitive entityIds must not be empty.");
        return new NativePrimitive(Id(item, "localId"), Name(item, "name"), ids);
    }

    private static NativeLineage ParseLineage(JsonElement value)
    {
        var item = Object(value, ["id", "kind", "name", "version", "entityIds"], ["representation"]);
        var kind = String(item, "kind");
        if (kind is not ("object" or "block_instance")) throw new InvalidDataException("Lineage kind is invalid.");
        string? representation = null;
        if (item.TryGetProperty("representation", out var representationValue))
        {
            if (representationValue.ValueKind != JsonValueKind.String || representationValue.GetString() != "fully-opened-wall")
                throw new InvalidDataException("Lineage representation is invalid.");
            representation = "fully-opened-wall";
        }
        return new NativeLineage(Uuid(item, "id"), kind, Name(item, "name"), Integer(item, "version", 1), Array(item.GetProperty("entityIds"), 100_000).Select(EntityId).ToArray(), representation);
    }

    private static NativeEntity ParseEntity(JsonElement value, ref int pointCount)
    {
        var item = Object(value, ["id", "layerId", "style", "geometry"]);
        var layerId = item.GetProperty("layerId").ValueKind == JsonValueKind.Null ? null : Uuid(item, "layerId");
        var style = ParseStyle(item.GetProperty("style"));
        var geometry = ParseGeometry(item.GetProperty("geometry"), ref pointCount);
        if ((geometry is NativeInsert) != style.IsBlockDefined) throw new InvalidDataException("Only INSERT uses block-defined style.");
        return new NativeEntity(Id(item, "id"), layerId, style, geometry);
    }

    private static NativeStyle ParseStyle(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Entity style must be an object.");
        var kind = String(value, "kind");
        if (kind == "block-defined")
        {
            Object(value, ["kind"]);
            return new NativeStyle(true, null, 0, null, null, 0);
        }
        if (kind != "resolved") throw new InvalidDataException("Entity style kind is invalid.");
        var item = Object(value, ["kind", "stroke", "strokeWidth", "fill", "requestedPaperLineweightMillimeters"], ["fontSize"]);
        var fillElement = item.GetProperty("fill");
        var fill = fillElement.ValueKind == JsonValueKind.Null ? null : Match(item, "fill", RgbaPattern, "RGB/RGBA color");
        double? fontSize = item.TryGetProperty("fontSize", out _) ? Positive(item, "fontSize", 10_000) : null;
        return new NativeStyle(false, Match(item, "stroke", RgbPattern, "RGB color"), Positive(item, "strokeWidth", 1_000), fill, fontSize, Positive(item, "requestedPaperLineweightMillimeters"));
    }

    private static NativeGeometry ParseGeometry(JsonElement value, ref int pointCount)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Entity geometry must be an object.");
        var type = String(value, "type");
        switch (type)
        {
            case "line":
            {
                var item = Object(value, ["type", "start", "end"]);
                var start = CountPoint(item.GetProperty("start"), ref pointCount);
                var end = CountPoint(item.GetProperty("end"), ref pointCount);
                if (start == end) throw new InvalidDataException("CAD line is degenerate.");
                return new NativeLine(start, end);
            }
            case "polyline":
            {
                var item = Object(value, ["type", "points", "closed"]);
                var points = new List<CadPoint>();
                foreach (var element in Array(item.GetProperty("points"), MaximumPoints)) points.Add(CountPoint(element, ref pointCount));
                if (points.Count < 2) throw new InvalidDataException("CAD polyline requires at least two points.");
                return new NativePolyline(points, Boolean(item, "closed"));
            }
            case "circle":
            {
                var item = Object(value, ["type", "center", "radius"]);
                return new NativeCircle(CountPoint(item.GetProperty("center"), ref pointCount), Positive(item, "radius"));
            }
            case "arc":
            {
                var item = Object(value, ["type", "center", "radius", "startAngleDegrees", "endAngleDegrees"]);
                var start = Number(item, "startAngleDegrees");
                var end = Number(item, "endAngleDegrees");
                if (!(end > start && end - start <= 360)) throw new InvalidDataException("CAD arc requires a positive counterclockwise sweep of at most 360 degrees.");
                return new NativeArc(CountPoint(item.GetProperty("center"), ref pointCount), Positive(item, "radius"), start, end);
            }
            case "text":
            {
                var item = Object(value, ["type", "origin", "text", "width", "fontSize", "lineHeight", "attachment", "wrapping", "rotationDegrees"]);
                Literal(item, "attachment", "top-left");
                Literal(item, "wrapping", "authored-newlines-only");
                var text = String(item, "text", 10_000);
                if (text.Contains("%%", StringComparison.Ordinal) || text.Contains("%<", StringComparison.Ordinal))
                    throw new InvalidDataException("MTEXT CAD control sequences %% and %< are unsupported.");
                if (text.Any(character => char.IsControl(character) && character is not ('\n' or '\r')))
                    throw new InvalidDataException("MTEXT contains an unsupported control character.");
                var width = Positive(item, "width");
                var fontSize = Positive(item, "fontSize");
                var lineHeight = Positive(item, "lineHeight");
                var lineSpacing = Derived(lineHeight * 3 / 5, "MTEXT native line spacing");
                if (lineSpacing is < 0.25 or > 4) throw new InvalidDataException("MTEXT native line spacing must be between 0.25 and 4.");
                _ = Derived(fontSize * lineHeight, "MTEXT baseline distance");
                var rotation = Number(item, "rotationDegrees");
                _ = Radians(rotation);
                return new NativeText(CountPoint(item.GetProperty("origin"), ref pointCount), text, width, fontSize, lineHeight, "top-left", "authored-newlines-only", rotation);
            }
            case "dimension":
            {
                var item = Object(value, ["type", "start", "end", "dimensionLinePoint", "textPosition", "fontSize", "precision", "suffix", "measurementMillimeters"]);
                var start = CountPoint(item.GetProperty("start"), ref pointCount);
                var end = CountPoint(item.GetProperty("end"), ref pointCount);
                if (start == end) throw new InvalidDataException("CAD dimension is degenerate.");
                if (Integer(item, "precision", 1, 1) != 1 || String(item, "suffix") != " mm") throw new InvalidDataException("CAD dimension precision or suffix policy is invalid.");
                var measurement = Positive(item, "measurementMillimeters");
                Equal(Math.Sqrt(Math.Pow(end.X - start.X, 2) + Math.Pow(end.Y - start.Y, 2)), measurement, "CAD dimension measurement does not match its points.", 1e-7);
                var dimensionLinePoint = CountPoint(item.GetProperty("dimensionLinePoint"), ref pointCount);
                var textPosition = CountPoint(item.GetProperty("textPosition"), ref pointCount);
                var fontSize = Positive(item, "fontSize");
                ValidateDimensionDerived(start, end, dimensionLinePoint, fontSize, measurement);
                return new NativeDimension(start, end, dimensionLinePoint, textPosition, fontSize, 1, " mm", measurement);
            }
            case "hatch":
            {
                var item = Object(value, ["type", "boundary", "color", "opacity"]);
                var opacity = Number(item, "opacity");
                if (!(opacity > 0 && opacity <= 1) || Math.Round(opacity * 255, MidpointRounding.AwayFromZero) < 1)
                    throw new InvalidDataException("HATCH opacity is not explicitly representable by the pinned engine.");
                var boundary = item.GetProperty("boundary");
                IReadOnlyList<CadPoint>? polygon = null;
                CadPoint? center = null;
                double? radius = null;
                if (boundary.ValueKind == JsonValueKind.Array)
                {
                    var points = new List<CadPoint>();
                    foreach (var element in Array(boundary, 4_096)) points.Add(CountPoint(element, ref pointCount));
                    polygon = points;
                    if (polygon.Count < 3 || !SimpleBoundary(polygon)) throw new InvalidDataException("CAD HATCH requires a simple polygon boundary.");
                }
                else
                {
                    var circle = Object(boundary, ["type", "center", "radius"]);
                    Literal(circle, "type", "circle");
                    center = CountPoint(circle.GetProperty("center"), ref pointCount);
                    radius = Positive(circle, "radius");
                }
                return new NativeHatch(polygon, center, radius, Match(item, "color", RgbPattern, "RGB color"), opacity);
            }
            case "insert":
            {
                var item = Object(value, ["type", "blockId", "origin", "rotationDegrees", "scaleX", "scaleY"]);
                var scaleX = Number(item, "scaleX");
                var scaleY = Number(item, "scaleY");
                if (scaleX == 0 || scaleY == 0) throw new InvalidDataException("INSERT scale must be non-zero.");
                var rotation = Number(item, "rotationDegrees");
                return new NativeInsert(Uuid(item, "blockId"), CountPoint(item.GetProperty("origin"), ref pointCount), rotation, scaleX, scaleY);
            }
            default: throw new InvalidDataException($"Unsupported CAD geometry type: {type}.");
        }
    }

    private static void ParseMetadata(JsonElement value, NativeScope scope, NativeCanvas canvas, IReadOnlyList<NativeLayer> layers, IReadOnlyList<NativeBlock> blocks, IReadOnlyList<NativeLineage> lineage)
    {
        var metadata = Object(value, ["structure", "schedulePlacement"]);
        Literal(metadata, "schedulePlacement", "not-authored");
        var structure = Object(metadata.GetProperty("structure"),
            ["revisionId", "pages", "canvases", "layers", "objects", "styles", "blocks", "blockInstances", "propertySchemas", "propertyValues", "tables"],
            ["sources", "tombstones"]);
        if (Uuid(structure, "revisionId") != scope.RevisionId) throw new InvalidDataException("Source revision does not match scope.");
        foreach (var collectionName in new[] { "pages", "canvases", "layers", "objects", "styles", "blocks", "blockInstances", "propertySchemas", "propertyValues", "tables" })
            if (structure.GetProperty(collectionName).ValueKind != JsonValueKind.Object) throw new InvalidDataException($"Source {collectionName} must be an object collection.");
        foreach (var optionalEmpty in new[] { "sources", "tombstones" })
            if (structure.TryGetProperty(optionalEmpty, out var optional) && (optional.ValueKind != JsonValueKind.Object || optional.EnumerateObject().Any()))
                throw new InvalidDataException($"Source {optionalEmpty} must be an empty object.");
        var canvases = structure.GetProperty("canvases");
        var pages = structure.GetProperty("pages");
        if (canvases.EnumerateObject().Count() != 1 || pages.EnumerateObject().Count() != 1) throw new InvalidDataException("Source must contain exactly one canvas and page.");
        var sourceCanvas = Property(canvases, canvas.Id);
        if (String(sourceCanvas, "pageId") != canvas.PageId || String(sourceCanvas, "name") != canvas.Name || Number(sourceCanvas, "widthMillimeters") != canvas.ModelWidth || Number(sourceCanvas, "heightMillimeters") != canvas.ModelHeight)
            throw new InvalidDataException("CAD canvas does not match opaque source envelope.");
        if (sourceCanvas.TryGetProperty("outputProfile", out var sourceProfile) && sourceProfile.ValueKind != JsonValueKind.Null && ParseOutputProfile(sourceProfile) != canvas.OutputProfile)
            throw new InvalidDataException("CAD output profile differs from persisted source profile.");

        var sourceLayers = structure.GetProperty("layers");
        if (sourceLayers.EnumerateObject().Count() != layers.Count) throw new InvalidDataException("Incomplete CAD layers.");
        foreach (var layer in layers)
        {
            var source = Property(sourceLayers, layer.Id);
            if (String(source, "id") != layer.Id || String(source, "name") != layer.Name || Boolean(source, "visible") != layer.Visible || Boolean(source, "locked") != layer.Locked || String(source, "systemKind") != layer.SystemKind || String(source, "canvasId") != layer.CanvasId || Integer(source, "sortOrder", 0) != layer.SortOrder || Integer(source, "version", 1) != layer.Version)
                throw new InvalidDataException("CAD layer differs from opaque source envelope.");
        }
        var sourceBlocks = structure.GetProperty("blocks");
        if (sourceBlocks.EnumerateObject().Count() != blocks.Count) throw new InvalidDataException("Incomplete CAD blocks.");
        foreach (var block in blocks)
        {
            var source = Property(sourceBlocks, block.Id);
            if (String(source, "name") != block.Name || Integer(source, "version", 1) != block.Version) throw new InvalidDataException("CAD block differs from opaque source envelope.");
            var authored = Array(source.GetProperty("primitives"), 100_000).ToArray();
            if (authored.Length != block.Primitives.Count) throw new InvalidDataException("CAD block primitive identity differs from source.");
            for (var index = 0; index < authored.Length; index++)
                if (String(authored[index], "localId") != block.Primitives[index].LocalId || String(authored[index], "name") != block.Primitives[index].Name)
                    throw new InvalidDataException("CAD block primitive identity differs from source.");
        }
        var sourceObjects = structure.GetProperty("objects");
        var sourceInstances = structure.GetProperty("blockInstances");
        if (lineage.Count != sourceObjects.EnumerateObject().Count() + sourceInstances.EnumerateObject().Count()) throw new InvalidDataException("Incomplete CAD lineage.");
        foreach (var item in lineage)
        {
            var source = Property(item.Kind == "object" ? sourceObjects : sourceInstances, item.Id);
            if (String(source, "name") != item.Name || Integer(source, "version", 1) != item.Version) throw new InvalidDataException("CAD lineage differs from source.");
            if (item.Representation is not null && (item.Kind != "object" || String(source.GetProperty("geometry"), "type") != "wall")) throw new InvalidDataException("Only an authored wall can use fully-opened-wall lineage.");
        }
    }

    private static void ParsePolicies(JsonElement value)
    {
        var item = Object(value, ["fontFile", "fontStatus", "fontRedistributed", "text", "plot", "plotStyleFile", "lineweight", "dimensionGraphics"]);
        Literal(item, "fontFile", "NotoSansKR-Regular.ttf");
        Literal(item, "fontStatus", "not-verified");
        if (Boolean(item, "fontRedistributed")) throw new InvalidDataException("Font redistribution policy is invalid.");
        Literal(item, "text", "literal-authored-newlines-only");
        Literal(item, "plot", "direct-rgb-lineweights");
        if (item.GetProperty("plotStyleFile").ValueKind != JsonValueKind.Null) throw new InvalidDataException("Plot style file policy is invalid.");
        Literal(item, "lineweight", "requested-paper-mm-not-quantized");
        Literal(item, "dimensionGraphics", "verify-generated-child-font-style");
    }

    private static void ValidateReferences(NativeScope scope, NativeCanvas canvas, IReadOnlyList<NativeLayer> layers, IReadOnlyList<NativeBlock> blocks, IReadOnlyList<NativeEntity> entities, IReadOnlyList<NativeLineage> lineage)
    {
        if (layers.Any(layer => layer.CanvasId != canvas.Id)) throw new InvalidDataException("Layer canvas reference is invalid.");
        var identities = new HashSet<string>(StringComparer.Ordinal);
        void Unique(string id) { if (!identities.Add(id)) throw new InvalidDataException($"Duplicate CAD identity {id}."); }
        var layerIds = new HashSet<string>(layers.Select(layer => layer.Id), StringComparer.Ordinal);
        foreach (var layer in layers) Unique(layer.Id);
        foreach (var block in blocks)
        {
            Unique(block.Id);
            var entityIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var entity in block.Entities)
            {
                Unique(entity.Id);
                if (!entityIds.Add(entity.Id) || entity.LayerId is not null || entity.Geometry is NativeInsert) throw new InvalidDataException("Block entities must be unique local non-INSERT geometry on layer 0.");
            }
            var mapped = new HashSet<string>(StringComparer.Ordinal);
            foreach (var primitive in block.Primitives)
                foreach (var entityId in primitive.EntityIds)
                    if (!entityIds.Contains(entityId) || !mapped.Add(entityId)) throw new InvalidDataException("Invalid block primitive lineage.");
            if (!mapped.SetEquals(entityIds)) throw new InvalidDataException("Unmapped block entities.");
        }
        var blockExtents = blocks.ToDictionary(block => block.Id, BlockExtents, StringComparer.Ordinal);
        var modelIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entity in entities)
        {
            Unique(entity.Id);
            if (!modelIds.Add(entity.Id) || entity.LayerId is null || !layerIds.Contains(entity.LayerId)) throw new InvalidDataException("Unknown model layer or duplicate model entity.");
            if (entity.Geometry is NativeInsert insert)
            {
                if (!blockExtents.TryGetValue(insert.BlockId, out var extents)) throw new InvalidDataException("Unknown INSERT block.");
                ValidateBlockTransform(insert, extents);
            }
            if (!entity.Style.IsBlockDefined && entity.Style.RequestedPaperLineweight != entity.Style.StrokeWidth / canvas.OutputProfile.ScaleDenominator)
                throw new InvalidDataException("Requested paper lineweight does not match world stroke width.");
        }
        foreach (var blockEntity in blocks.SelectMany(block => block.Entities))
            if (!blockEntity.Style.IsBlockDefined && blockEntity.Style.RequestedPaperLineweight != blockEntity.Style.StrokeWidth / canvas.OutputProfile.ScaleDenominator)
                throw new InvalidDataException("Requested paper lineweight does not match world stroke width.");
        var mappedModel = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in lineage)
        {
            Unique(item.Id);
            if (item.EntityIds.Count == 0 && item.Representation != "fully-opened-wall") throw new InvalidDataException("Unexpected empty CAD lineage.");
            if (item.EntityIds.Count > 0 && item.Representation is not null) throw new InvalidDataException("Represented wall cannot also map entities.");
            foreach (var entityId in item.EntityIds)
                if (!modelIds.Contains(entityId) || !mappedModel.Add(entityId)) throw new InvalidDataException("Invalid model entity lineage.");
        }
        if (!mappedModel.SetEquals(modelIds)) throw new InvalidDataException("Unmapped model entities.");
        _ = scope;
    }

    private static NativeExtents BlockExtents(NativeBlock block)
    {
        var minX = double.PositiveInfinity;
        var minY = double.PositiveInfinity;
        var maxX = double.NegativeInfinity;
        var maxY = double.NegativeInfinity;

        void Include(CadPoint point)
        {
            minX = Math.Min(minX, Derived(point.X, "block extent X"));
            minY = Math.Min(minY, Derived(point.Y, "block extent Y"));
            maxX = Math.Max(maxX, point.X);
            maxY = Math.Max(maxY, point.Y);
        }

        void Curve(CadPoint center, double radius)
        {
            Include(new CadPoint(Derived(center.X - radius, "curved minimum X"), Derived(center.Y - radius, "curved minimum Y")));
            Include(new CadPoint(Derived(center.X + radius, "curved maximum X"), Derived(center.Y + radius, "curved maximum Y")));
        }

        void Text(NativeText text)
        {
            var angle = Radians(text.RotationDegrees);
            var height = Derived(text.FontSize * text.LineHeight * Math.Max(1, NormalizeNewlines(text.Text).Count(character => character == '\n') + 1), "MTEXT authored paragraph extent");
            var widthX = Derived(Math.Cos(angle) * text.Width, "MTEXT width extent");
            var widthY = Derived(Math.Sin(angle) * text.Width, "MTEXT width extent");
            var heightX = Derived(Math.Sin(angle) * height, "MTEXT height extent");
            var heightY = Derived(-Math.Cos(angle) * height, "MTEXT height extent");
            Include(text.Origin);
            Include(new CadPoint(Derived(text.Origin.X + widthX, "MTEXT extent X"), Derived(text.Origin.Y + widthY, "MTEXT extent Y")));
            Include(new CadPoint(Derived(text.Origin.X + heightX, "MTEXT extent X"), Derived(text.Origin.Y + heightY, "MTEXT extent Y")));
            Include(new CadPoint(Derived(text.Origin.X + widthX + heightX, "MTEXT extent X"), Derived(text.Origin.Y + widthY + heightY, "MTEXT extent Y")));
        }

        void Dimension(NativeDimension dimension)
        {
            var displayStart = new CadPoint(
                Derived(dimension.Start.X + dimension.DimensionLinePoint.X - dimension.End.X, "DIMENSION display start X"),
                Derived(dimension.Start.Y + dimension.DimensionLinePoint.Y - dimension.End.Y, "DIMENSION display start Y"));
            var ux = (dimension.End.X - dimension.Start.X) / dimension.Measurement;
            var uy = (dimension.End.Y - dimension.Start.Y) / dimension.Measurement;
            var offsetX = displayStart.X - dimension.Start.X;
            var offsetY = displayStart.Y - dimension.Start.Y;
            var offsetLength = Math.Sqrt(offsetX * offsetX + offsetY * offsetY);
            var nx = offsetLength == 0 ? 0 : offsetX / offsetLength;
            var ny = offsetLength == 0 ? 1 : offsetY / offsetLength;
            foreach (var point in new[]
            {
                dimension.Start, dimension.End, displayStart, dimension.DimensionLinePoint, dimension.TextPosition,
                new CadPoint(dimension.Start.X + nx * 0.625, dimension.Start.Y + ny * 0.625),
                new CadPoint(displayStart.X + nx * 1.25, displayStart.Y + ny * 1.25),
                new CadPoint(dimension.End.X + nx * 0.625, dimension.End.Y + ny * 0.625),
                new CadPoint(dimension.DimensionLinePoint.X + nx * 1.25, dimension.DimensionLinePoint.Y + ny * 1.25),
            }) Include(point);
            var px = -uy;
            var py = ux;
            var half = dimension.FontSize / 6;
            foreach (var arrow in new[] { (displayStart, ux, uy), (dimension.DimensionLinePoint, -ux, -uy) })
            {
                Include(new CadPoint(arrow.Item1.X + arrow.Item2 * dimension.FontSize + px * half, arrow.Item1.Y + arrow.Item3 * dimension.FontSize + py * half));
                Include(new CadPoint(arrow.Item1.X + arrow.Item2 * dimension.FontSize - px * half, arrow.Item1.Y + arrow.Item3 * dimension.FontSize - py * half));
            }
            var textWidth = Derived((dimension.Measurement.ToString("F1", CultureInfo.InvariantCulture) + dimension.Suffix).Length * dimension.FontSize * 2, "DIMENSION text extent");
            Include(new CadPoint(Derived(dimension.TextPosition.X + textWidth, "DIMENSION text extent X"), Derived(dimension.TextPosition.Y - dimension.FontSize * 1.2, "DIMENSION text extent Y")));
        }

        foreach (var entity in block.Entities)
        {
            switch (entity.Geometry)
            {
                case NativeLine line: Include(line.Start); Include(line.End); break;
                case NativePolyline polyline: foreach (var point in polyline.Points) Include(point); break;
                case NativeCircle circle: Curve(circle.Center, circle.Radius); break;
                case NativeArc arc: Curve(arc.Center, arc.Radius); break;
                case NativeText text: Text(text); break;
                case NativeDimension dimension: Dimension(dimension); break;
                case NativeHatch { Polygon: not null } hatch: foreach (var point in hatch.Polygon) Include(point); break;
                case NativeHatch hatch: Curve(hatch.CircleCenter!.Value, hatch.CircleRadius!.Value); break;
                default: throw new InvalidDataException("Unsupported block geometry transform.");
            }
        }
        return double.IsPositiveInfinity(minX) ? new NativeExtents(0, 0, 0, 0) : new NativeExtents(minX, minY, maxX, maxY);
    }

    private static void ValidateBlockTransform(NativeInsert insert, NativeExtents extents)
    {
        var rotation = Radians(insert.RotationDegrees);
        var xx = Derived(Math.Cos(rotation) * insert.ScaleX, "INSERT transformed X basis");
        var xy = Derived(-Math.Sin(rotation) * insert.ScaleY, "INSERT transformed Y basis");
        var yx = Derived(Math.Sin(rotation) * insert.ScaleX, "INSERT transformed X basis");
        var yy = Derived(Math.Cos(rotation) * insert.ScaleY, "INSERT transformed Y basis");
        foreach (var point in new[]
        {
            new CadPoint(extents.MinX, extents.MinY), new CadPoint(extents.MinX, extents.MaxY),
            new CadPoint(extents.MaxX, extents.MinY), new CadPoint(extents.MaxX, extents.MaxY),
        })
        {
            var x = Derived(Derived(insert.Origin.X + Derived(xx * point.X, "INSERT X multiplication"), "INSERT X translation") + Derived(xy * point.Y, "INSERT X multiplication"), "INSERT X addition");
            var y = Derived(Derived(insert.Origin.Y + Derived(yx * point.X, "INSERT Y multiplication"), "INSERT Y translation") + Derived(yy * point.Y, "INSERT Y multiplication"), "INSERT Y addition");
            if (Math.Abs(x) > MaximumCoordinate || Math.Abs(y) > MaximumCoordinate) throw new InvalidDataException("INSERT transformed geometry exceeds the bounded coordinate domain.");
        }
    }

    private static void ValidateRawJson(JsonElement root)
    {
        var stack = new Stack<(JsonElement Value, int Depth)>();
        stack.Push((root, 0));
        var nodes = 0;
        while (stack.Count > 0)
        {
            var (value, depth) = stack.Pop();
            if (++nodes > MaximumNodes || depth > 64) throw new InvalidDataException("CAD JSON budget exceeded.");
            switch (value.ValueKind)
            {
                case JsonValueKind.Object:
                {
                    var names = new HashSet<string>(StringComparer.Ordinal);
                    foreach (var property in value.EnumerateObject())
                    {
                        if (!names.Add(property.Name)) throw new InvalidDataException($"Duplicate JSON property: {property.Name}.");
                        ValidateText(property.Name);
                        stack.Push((property.Value, depth + 1));
                    }
                    break;
                }
                case JsonValueKind.Array:
                    foreach (var item in value.EnumerateArray()) stack.Push((item, depth + 1));
                    break;
                case JsonValueKind.String: ValidateText(value.GetString()!); break;
                case JsonValueKind.Number:
                    if (!value.TryGetDouble(out var number) || !double.IsFinite(number)) throw new InvalidDataException("CAD JSON numbers must be finite.");
                    break;
                case JsonValueKind.True:
                case JsonValueKind.False:
                case JsonValueKind.Null: break;
                default: throw new InvalidDataException("CAD input must contain finite JSON.");
            }
        }
    }

    private static void ValidateText(string value)
    {
        if (value.Length > MaximumBytes || value.Contains('\0')) throw new InvalidDataException("CAD input contains invalid or oversized Unicode text.");
        for (var index = 0; index < value.Length; index++)
        {
            if (char.IsHighSurrogate(value[index]))
            {
                if (++index >= value.Length || !char.IsLowSurrogate(value[index])) throw new InvalidDataException("CAD input contains invalid Unicode text.");
            }
            else if (char.IsLowSurrogate(value[index])) throw new InvalidDataException("CAD input contains invalid Unicode text.");
        }
    }

    private static JsonElement Object(JsonElement value, IReadOnlyCollection<string> required, IReadOnlyCollection<string>? optional = null)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Expected a JSON object.");
        var allowed = new HashSet<string>(required, StringComparer.Ordinal);
        if (optional is not null) allowed.UnionWith(optional);
        foreach (var property in value.EnumerateObject()) if (!allowed.Contains(property.Name)) throw new InvalidDataException($"Unknown consumed property: {property.Name}.");
        foreach (var name in required) if (!value.TryGetProperty(name, out _)) throw new InvalidDataException($"Missing consumed property: {name}.");
        return value;
    }

    private static IEnumerable<JsonElement> Array(JsonElement value, int maximum)
    {
        if (value.ValueKind != JsonValueKind.Array) throw new InvalidDataException("Expected a JSON array.");
        if (value.GetArrayLength() > maximum) throw new InvalidDataException("CAD collection budget exceeded.");
        return value.EnumerateArray();
    }

    private static JsonElement Property(JsonElement collection, string name) =>
        collection.TryGetProperty(name, out var value) ? value : throw new InvalidDataException($"Opaque source envelope is missing {name}.");
    private static string String(JsonElement value, string name, int maximum = 1024) => String(value.GetProperty(name), maximum);
    private static string String(JsonElement value, int maximum = 1024)
    {
        if (value.ValueKind != JsonValueKind.String) throw new InvalidDataException("Expected a JSON string.");
        var result = value.GetString()!;
        if (result.Length > maximum) throw new InvalidDataException("CAD string exceeds its budget.");
        return result;
    }
    private static string Name(JsonElement value, string name)
    {
        var result = String(value, name, 255);
        if (result.Length == 0 || result != result.Trim()) throw new InvalidDataException("CAD name is empty or not exactly trimmed.");
        return result;
    }
    private static string Id(JsonElement value, string name) => EntityId(value.GetProperty(name));
    private static string EntityId(JsonElement value)
    {
        var result = String(value, 1024);
        if (result.Length == 0) throw new InvalidDataException("CAD entity identity is empty.");
        return result;
    }
    private static string Uuid(JsonElement value, string name)
    {
        var result = String(value, name, 36);
        if (!UuidPattern.IsMatch(result)) throw new InvalidDataException($"{name} is not a valid UUID.");
        return result;
    }
    private static string Match(JsonElement value, string name, Regex pattern, string label)
    {
        var result = String(value, name);
        if (!pattern.IsMatch(result)) throw new InvalidDataException($"{name} is not a valid {label}.");
        return result;
    }
    private static bool Boolean(JsonElement value, string name)
    {
        var property = value.GetProperty(name);
        return property.ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => throw new InvalidDataException($"{name} must be boolean.") };
    }
    private static double Number(JsonElement value, string name)
    {
        if (!value.GetProperty(name).TryGetDouble(out var result) || !double.IsFinite(result)) throw new InvalidDataException($"{name} must be finite.");
        return result;
    }
    private static double Positive(JsonElement value, string name, double maximum = double.MaxValue)
    {
        var result = Number(value, name);
        if (!(result > 0 && result <= maximum)) throw new InvalidDataException($"{name} must be positive and bounded.");
        return result;
    }
    private static int Integer(JsonElement value, string name, int minimum, int maximum = int.MaxValue)
    {
        if (!value.GetProperty(name).TryGetInt32(out var result) || result < minimum || result > maximum) throw new InvalidDataException($"{name} must be a bounded integer.");
        return result;
    }
    private static long Integer64(JsonElement value, string name, long minimum, long maximum)
    {
        if (!value.GetProperty(name).TryGetInt64(out var result) || result < minimum || result > maximum) throw new InvalidDataException($"{name} must be a bounded integer.");
        return result;
    }
    private static void Literal(JsonElement value, string name, string expected)
    {
        if (String(value, name) != expected) throw new InvalidDataException($"{name} policy is invalid.");
    }
    private static CadPoint Point(JsonElement value)
    {
        var item = Object(value, ["x", "y"]);
        var point = new CadPoint(Number(item, "x"), Number(item, "y"));
        if (Math.Abs(point.X) > MaximumCoordinate || Math.Abs(point.Y) > MaximumCoordinate) throw new InvalidDataException("CAD point is outside the bounded coordinate domain.");
        return point;
    }
    private static CadPoint CountPoint(JsonElement value, ref int count)
    {
        if (++count > MaximumPoints) throw new InvalidDataException("CAD aggregate point budget exceeded.");
        return Point(value);
    }
    private static void Equal(double expected, double actual, string message, double tolerance = 0)
    {
        if (!double.IsFinite(expected) || !double.IsFinite(actual) || Math.Abs(expected - actual) > tolerance) throw new InvalidDataException(message);
    }
    private static double Derived(double value, string label) => double.IsFinite(value) ? value : throw new InvalidDataException($"Derived {label} is not representable.");
    private static double Radians(double degrees) => Derived((degrees % 360) * Math.PI / 180, "rotation");
    private static void ValidateDimensionDerived(CadPoint start, CadPoint end, CadPoint definition, double fontSize, double measurement)
    {
        var displayStart = new CadPoint(
            Derived(start.X + definition.X - end.X, "DIMENSION display start X"),
            Derived(start.Y + definition.Y - end.Y, "DIMENSION display start Y"));
        var ux = Derived((end.X - start.X) / measurement, "DIMENSION X direction");
        var uy = Derived((end.Y - start.Y) / measurement, "DIMENSION Y direction");
        var px = -uy;
        var py = ux;
        var half = fontSize / 6;
        foreach (var arrow in new[] { (displayStart, ux, uy), (definition, -ux, -uy) })
        {
            _ = Derived(arrow.Item1.X + arrow.Item2 * fontSize + px * half, "DIMENSION arrow corner X");
            _ = Derived(arrow.Item1.Y + arrow.Item3 * fontSize + py * half, "DIMENSION arrow corner Y");
            _ = Derived(arrow.Item1.X + arrow.Item2 * fontSize - px * half, "DIMENSION arrow corner X");
            _ = Derived(arrow.Item1.Y + arrow.Item3 * fontSize - py * half, "DIMENSION arrow corner Y");
        }
    }
    private static bool SimpleBoundary(IReadOnlyList<CadPoint> points)
    {
        static double Cross(CadPoint a, CadPoint b, CadPoint c) => (b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X);
        static bool On(CadPoint a, CadPoint b, CadPoint p) => Cross(a, b, p) == 0 && p.X >= Math.Min(a.X, b.X) && p.X <= Math.Max(a.X, b.X) && p.Y >= Math.Min(a.Y, b.Y) && p.Y <= Math.Max(a.Y, b.Y);
        static bool Intersects(CadPoint a, CadPoint b, CadPoint c, CadPoint d)
        {
            var x = Cross(a, b, c); var y = Cross(a, b, d); var u = Cross(c, d, a); var v = Cross(c, d, b);
            return (Math.Sign(x) != Math.Sign(y) && Math.Sign(u) != Math.Sign(v)) || On(a, b, c) || On(a, b, d) || On(c, d, a) || On(c, d, b);
        }
        if (points.Count is < 3 or > 4_096) return false;
        var area = 0d;
        for (var i = 0; i < points.Count; i++)
        {
            var a = points[i]; var b = points[(i + 1) % points.Count];
            if (a == b) return false;
            area += Cross(points[0], a, b);
            for (var j = i + 1; j < points.Count; j++)
            {
                if (j == i + 1 || (i == 0 && j == points.Count - 1)) continue;
                if (Intersects(a, b, points[j], points[(j + 1) % points.Count])) return false;
            }
        }
        return double.IsFinite(area) && area != 0;
    }
    private static string NormalizeNewlines(string value) => value.Replace("\r\n", "\n", StringComparison.Ordinal).Replace("\r", "\n", StringComparison.Ordinal);
}
