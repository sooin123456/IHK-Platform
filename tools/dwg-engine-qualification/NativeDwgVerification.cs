using System.Globalization;
using ACadSharp;
using ACadSharp.Blocks;
using ACadSharp.Entities;
using ACadSharp.Objects;
using ACadSharp.Tables;
using CSMath;

namespace DwgEngineQualification;

internal sealed record NativeEntityReadBack(string Id, string Handle, string Owner, string Type, string Layer, string Geometry);
internal sealed record NativeLayerReadBack(string Id, string CadName, string SourceName, string Handle, bool Visible, bool Locked);
internal sealed record NativeBlockReadBack(string Id, string CadName, string SourceName, string Handle, IReadOnlyList<string> EntityHandles);
internal sealed record NativeLayoutReadBack(string Name, double PaperWidth, double PaperHeight, string PaperUnits, IReadOnlyList<object> Viewports);
internal sealed record NativeQuantization(string EntityId, string Kind, double Requested, double Stored, string NativeValue);
internal sealed record NativeVerificationResult(
    IReadOnlyList<string> Failures,
    IReadOnlyList<NativeEntityReadBack> Entities,
    IReadOnlyList<NativeLayerReadBack> Layers,
    IReadOnlyList<NativeBlockReadBack> Blocks,
    IReadOnlyList<NativeLayoutReadBack> Layouts,
    IReadOnlyList<NativeQuantization> Quantizations,
    IReadOnlyDictionary<string, IReadOnlyList<string>> DimensionChildHandles,
    object ActualInventory);

internal static class NativeDwgVerification
{
    public const double GeometryTolerance = 1e-7;
    public const double AngularTolerance = 1e-10;

    public static NativeVerificationResult Compare(
        NativeCadManifest manifest,
        CadDocument actual,
        IReadOnlyDictionary<string, string> entityHandles,
        IReadOnlyDictionary<string, string> blockHandles,
        IReadOnlyDictionary<string, IReadOnlyList<string>> dimensionChildHandles)
    {
        var failures = new List<string>();
        if (actual.Header.VersionString != "AC1024") failures.Add($"DWG version is {actual.Header.VersionString}, expected AC1024");
        if (actual.Header.InsUnits != ACadSharp.Types.Units.UnitsType.Millimeters) failures.Add($"DWG units are {actual.Header.InsUnits}, expected Millimeters");

        var allEntities = actual.BlockRecords.SelectMany(block => block.Entities).ToArray();
        var duplicateHandles = allEntities.GroupBy(entity => Handle(entity.Handle), StringComparer.Ordinal).Where(group => group.Count() > 1).ToArray();
        foreach (var duplicate in duplicateHandles) failures.Add($"read-back contains duplicate entity handle {duplicate.Key}");
        var actualByHandle = allEntities.GroupBy(entity => Handle(entity.Handle), StringComparer.Ordinal).ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        if (actual.Entities.Count() != manifest.Entities.Count) failures.Add($"model entity count is {actual.Entities.Count()}, expected {manifest.Entities.Count}");
        var expectedModelOrder = manifest.Entities.Select(entity => entityHandles[entity.Id]).ToArray();
        if (!expectedModelOrder.SequenceEqual(actual.Entities.Select(entity => Handle(entity.Handle)), StringComparer.Ordinal)) failures.Add("model entity order or handles changed");

        var records = new List<NativeEntityReadBack>();
        var quantizations = new List<NativeQuantization>();
        var blockOwnerByEntity = manifest.Blocks.SelectMany(block => block.Entities.Select(entity => (entity.Id, block))).ToDictionary(pair => pair.Id, pair => pair.block, StringComparer.Ordinal);
        foreach (var source in manifest.Blocks.SelectMany(block => block.Entities).Concat(manifest.Entities))
        {
            if (!entityHandles.TryGetValue(source.Id, out var handle) || !actualByHandle.TryGetValue(handle, out var entity))
            {
                failures.Add($"requested entity {source.Id} is missing after read-back");
                continue;
            }
            var expectedOwner = blockOwnerByEntity.TryGetValue(source.Id, out var blockOwner) ? blockOwner.CadName : "*Model_Space";
            var owner = (entity.Owner as BlockRecord)?.Name ?? "<missing>";
            var expectedLayer = source.LayerId is null ? "0" : manifest.Layers.Single(layer => layer.Id == source.LayerId).CadName;
            var expectedType = TypeName(source.Geometry);
            if (owner != expectedOwner) failures.Add($"entity {source.Id} owner is {owner}, expected {expectedOwner}");
            if ((entity.Layer?.Name ?? "<missing>") != expectedLayer) failures.Add($"entity {source.Id} layer changed");
            if (entity.ObjectName != expectedType) failures.Add($"entity {source.Id} type is {entity.ObjectName}, expected {expectedType}");
            CompareEntityState(source, entity, failures);
            if (!source.Style.IsBlockDefined)
            {
                var requestedColor = source.Geometry is NativeHatch hatch ? hatch.Color : source.Style.Stroke!;
                CompareColor(source.Id, entity.Color, NativeDwgWriter.ColorFromHex(requestedColor), failures);
                var expectedWeight = NativeDwgWriter.QuantizeLineweight(source.Style.RequestedPaperLineweight);
                if (entity.LineWeight != expectedWeight) failures.Add($"entity {source.Id} lineweight is {entity.LineWeight}, expected {expectedWeight}");
                quantizations.Add(new NativeQuantization(source.Id, "paper-lineweight-millimeters", source.Style.RequestedPaperLineweight, (short)entity.LineWeight / 100d, entity.LineWeight.ToString()));
            }
            else if (!entity.Color.IsByLayer || entity.LineWeight != LineWeightType.ByLayer)
            {
                failures.Add($"entity {source.Id} block-defined rendering style changed");
            }
            CompareGeometry(source, entity, dimensionChildHandles, failures, quantizations);
            records.Add(new NativeEntityReadBack(source.Id, handle, owner, entity.ObjectName, entity.Layer?.Name ?? "<missing>", Geometry(entity)));
        }
        if (records.Select(record => record.Handle).Distinct(StringComparer.Ordinal).Count() != records.Count) failures.Add("multiple requested entities map to one handle");

        var layerRecords = new List<NativeLayerReadBack>();
        foreach (var source in manifest.Layers)
        {
            var matches = actual.Layers.Where(layer => layer.Name == source.CadName).ToArray();
            if (matches.Length != 1)
            {
                failures.Add($"layer {source.Id} has {matches.Length} read-back definitions");
                continue;
            }
            var layer = matches[0];
            var locked = layer.Flags.HasFlag(LayerFlags.Locked);
            if (layer.IsOn != source.Visible || locked != source.Locked) failures.Add($"layer {source.Id} visibility/lock state changed");
            layerRecords.Add(new NativeLayerReadBack(source.Id, source.CadName, source.Name, Handle(layer.Handle), layer.IsOn, locked));
        }

        var blockRecords = new List<NativeBlockReadBack>();
        foreach (var source in manifest.Blocks)
        {
            if (!blockHandles.TryGetValue(source.Id, out var handle))
            {
                failures.Add($"block {source.Id} has no real handle mapping");
                continue;
            }
            var matches = actual.BlockRecords.Where(block => Handle(block.Handle) == handle && block.Name == source.CadName).ToArray();
            if (matches.Length != 1)
            {
                failures.Add($"block {source.Id} has {matches.Length} read-back definitions");
                continue;
            }
            var block = matches[0];
            if (block.Units != ACadSharp.Types.Units.UnitsType.Millimeters || !string.IsNullOrWhiteSpace(block.BlockEntity.XRefPath) || block.BlockEntity.Flags.HasFlag(BlockTypeFlags.XRef)) failures.Add($"block {source.Id} is not an ordinary millimeter block");
            if (!PointEquals(new CadPoint(0, 0), block.BlockEntity.BasePoint)) failures.Add($"block {source.Id} base point changed");
            var expectedHandles = source.Entities.Select(entity => entityHandles[entity.Id]).ToArray();
            var actualHandles = block.Entities.Select(entity => Handle(entity.Handle)).ToArray();
            if (!expectedHandles.SequenceEqual(actualHandles, StringComparer.Ordinal)) failures.Add($"block {source.Id} primitive order or entity handles changed");
            blockRecords.Add(new NativeBlockReadBack(source.Id, source.CadName, source.Name, handle, actualHandles));
        }
        if (actual.BlockRecords.Count(block => block.Name.StartsWith("B_", StringComparison.Ordinal)) != manifest.Blocks.Count) failures.Add("unexpected ordinary CAD block definitions were read back");

        var layouts = VerifyLayouts(manifest.Canvas, actual, failures);
        var actualDimensionChildren = manifest.Blocks.SelectMany(block => block.Entities).Concat(manifest.Entities).Where(entity => entity.Geometry is NativeDimension).ToDictionary(
            entity => entity.Id,
            entity => (IReadOnlyList<string>)(actualByHandle.TryGetValue(entityHandles[entity.Id], out var value) && value is DimensionAligned dimension
                ? dimension.Block.Entities.Select(child => Handle(child.Handle)).ToArray()
                : []),
            StringComparer.Ordinal);
        var inventory = new
        {
            version = actual.Header.VersionString,
            units = actual.Header.InsUnits.ToString(),
            modelEntityCount = actual.Entities.Count(),
            allBlockEntityCount = allEntities.Length,
            layerCount = actual.Layers.Count(),
            blockRecordCount = actual.BlockRecords.Count(),
            layoutCount = actual.Layouts.Count(),
            textStyles = actual.TextStyles.Select(style => new { handle = Handle(style.Handle), style.Name, fontFile = style.Filename ?? string.Empty }).ToArray(),
        };
        return new NativeVerificationResult(failures, records, layerRecords, blockRecords, layouts, quantizations, actualDimensionChildren, inventory);
    }

    private static void CompareGeometry(
        NativeEntity source,
        Entity actual,
        IReadOnlyDictionary<string, IReadOnlyList<string>> expectedDimensionChildren,
        ICollection<string> failures,
        ICollection<NativeQuantization> quantizations)
    {
        switch (source.Geometry)
        {
            case NativeLine expected when actual is Line line:
                Point(expected.Start, line.StartPoint, source.Id, "line start", failures);
                Point(expected.End, line.EndPoint, source.Id, "line end", failures);
                Planar(line.Normal, line.Thickness, source.Id, "line", failures);
                break;
            case NativePolyline expected when actual is LwPolyline polyline:
                if (polyline.IsClosed != expected.Closed || polyline.Vertices.Count != expected.Points.Count) failures.Add($"polyline {source.Id} closure or point count changed");
                for (var index = 0; index < Math.Min(polyline.Vertices.Count, expected.Points.Count); index++) Point(expected.Points[index], polyline.Vertices[index].Location, source.Id, $"polyline point {index}", failures);
                if (!Zero(polyline.Elevation)) failures.Add($"polyline {source.Id} elevation changed");
                if (!Zero(polyline.ConstantWidth)) failures.Add($"polyline {source.Id} constant width changed");
                if (polyline.Vertices.Any(vertex => !Zero(vertex.Bulge))) failures.Add($"polyline {source.Id} vertex bulge changed");
                if (polyline.Vertices.Any(vertex => !Zero(vertex.StartWidth) || !Zero(vertex.EndWidth))) failures.Add($"polyline {source.Id} vertex width changed");
                Planar(polyline.Normal, polyline.Thickness, source.Id, "polyline", failures);
                break;
            case NativeCircle expected when actual is Circle circle:
                Point(expected.Center, circle.Center, source.Id, "circle center", failures);
                Near(expected.Radius, circle.Radius, source.Id, "circle radius", failures);
                Planar(circle.Normal, circle.Thickness, source.Id, "circle", failures);
                break;
            case NativeArc expected when actual is Arc arc:
                Point(expected.Center, arc.Center, source.Id, "arc center", failures);
                Near(expected.Radius, arc.Radius, source.Id, "arc radius", failures);
                Angle(NativeDwgWriter.Degrees(expected.StartAngleDegrees), arc.StartAngle, source.Id, "arc start angle", failures);
                var expectedSweep = (expected.EndAngleDegrees - expected.StartAngleDegrees) * Math.PI / 180;
                var actualSweep = arc.EndAngle - arc.StartAngle;
                if (Math.Abs(expectedSweep - MathHelper.TwoPI) <= AngularTolerance)
                    Near(expectedSweep, actualSweep, source.Id, "full arc sweep", failures, AngularTolerance);
                else Angle(expectedSweep, actualSweep, source.Id, "arc sweep", failures);
                Planar(arc.Normal, arc.Thickness, source.Id, "arc", failures);
                break;
            case NativeText expected when actual is MText text:
                Point(expected.Origin, text.InsertPoint, source.Id, "text origin", failures);
                if (text.PlainText != NormalizeNewlines(expected.Text)) failures.Add($"text {source.Id} literal content changed");
                Near(expected.Width, text.RectangleWidth, source.Id, "text width", failures);
                Near(expected.FontSize, text.Height, source.Id, "text height", failures);
                Near(expected.LineHeight * 3 / 5, text.LineSpacing, source.Id, "text line spacing", failures);
                Near(expected.FontSize * expected.LineHeight, text.Height * text.LineSpacing * 5 / 3, source.Id, "text baseline distance", failures);
                if (text.AttachmentPoint != AttachmentPointType.TopLeft) failures.Add($"text {source.Id} attachment is not TopLeft");
                if (text.LineSpacingStyle != LineSpacingStyleType.Exact) failures.Add($"text {source.Id} line spacing style changed");
                Angle(NativeDwgWriter.Degrees(expected.RotationDegrees), text.Rotation, source.Id, "text rotation", failures);
                var expectedRotation = NativeDwgWriter.Degrees(expected.RotationDegrees);
                Vector(new XYZ(Math.Cos(expectedRotation), Math.Sin(expectedRotation), 0), text.AlignmentPoint, source.Id, "text alignment", failures);
                if (text.Style?.Filename != "NotoSansKR-Regular.ttf") failures.Add($"text {source.Id} font file changed");
                Vector(XYZ.AxisZ, text.Normal, source.Id, "text normal", failures);
                break;
            case NativeInsert expected when actual is Insert insert:
                Point(expected.Origin, insert.InsertPoint, source.Id, "insert origin", failures);
                Near(expected.ScaleX, insert.XScale, source.Id, "insert X scale", failures);
                Near(expected.ScaleY, insert.YScale, source.Id, "insert Y scale", failures);
                Near(1, insert.ZScale, source.Id, "insert Z scale", failures);
                Angle(NativeDwgWriter.Degrees(expected.RotationDegrees), insert.Rotation, source.Id, "insert rotation", failures);
                var expectedBlockName = expected.BlockId.Replace("-", string.Empty, StringComparison.Ordinal).ToLowerInvariant().Insert(0, "B_");
                if (insert.Block?.Name != expectedBlockName) failures.Add($"insert {source.Id} block reference changed");
                if (insert.Block is not null && !PointEquals(new CadPoint(0, 0), insert.Block.BlockEntity.BasePoint)) failures.Add($"insert {source.Id} block base point changed");
                Vector(XYZ.AxisZ, insert.Normal, source.Id, "insert normal", failures);
                if (insert.RowCount != 1 || insert.ColumnCount != 1 || !Zero(insert.RowSpacing) || !Zero(insert.ColumnSpacing)) failures.Add($"insert {source.Id} array semantics changed");
                var rotation = NativeDwgWriter.Degrees(expected.RotationDegrees);
                Near(Math.Cos(rotation) * expected.ScaleX, Math.Cos(insert.Rotation) * insert.XScale, source.Id, "insert transformed X basis", failures);
                Near(Math.Sin(rotation) * expected.ScaleX, Math.Sin(insert.Rotation) * insert.XScale, source.Id, "insert transformed X basis", failures);
                Near(-Math.Sin(rotation) * expected.ScaleY, -Math.Sin(insert.Rotation) * insert.YScale, source.Id, "insert transformed Y basis", failures);
                Near(Math.Cos(rotation) * expected.ScaleY, Math.Cos(insert.Rotation) * insert.YScale, source.Id, "insert transformed Y basis", failures);
                break;
            case NativeHatch expected when actual is Hatch hatch:
                CompareHatch(source.Id, expected, hatch, failures, quantizations);
                break;
            case NativeDimension expected when actual is DimensionAligned dimension:
                CompareDimension(source, expected, dimension, expectedDimensionChildren, failures);
                break;
            default:
                failures.Add($"entity {source.Id} geometry could not be compared as {source.Geometry.Type}");
                break;
        }
    }

    private static void CompareHatch(string id, NativeHatch expected, Hatch hatch, ICollection<string> failures, ICollection<NativeQuantization> quantizations)
    {
        if (!hatch.IsSolid || hatch.IsAssociative || hatch.Paths.Count != 1 || hatch.PatternType != HatchPatternType.SolidFill || hatch.Style != HatchStyleType.Normal || !PointEquals(new CadPoint(0, 0), new XY(hatch.Normal.X, hatch.Normal.Y)) || !NearValue(1, hatch.Normal.Z) || !Zero(hatch.Elevation))
            failures.Add($"hatch {id} solid/associative/path/normal semantics changed");
        CompareColor(id, hatch.Color, NativeDwgWriter.ColorFromHex(expected.Color), failures);
        var requestedTransparency = NativeDwgWriter.Opacity(expected.Opacity);
        var requestedPacked = Transparency.ToAlphaValue(requestedTransparency);
        var storedPacked = Transparency.ToAlphaValue(hatch.Transparency);
        if (hatch.Transparency.Value != requestedTransparency.Value || storedPacked != requestedPacked) failures.Add($"hatch {id} transparency quantization changed");
        var storedAlpha = storedPacked & 0xff;
        quantizations.Add(new NativeQuantization(id, "opacity", expected.Opacity, storedAlpha / 255d, $"transparency={hatch.Transparency.Value};packedAlpha={storedAlpha}"));
        var path = hatch.Paths[0];
        if (!path.Flags.HasFlag(BoundaryPathFlags.External) || path.Edges.Count != 1) failures.Add($"hatch {id} boundary path flags or edge count changed");
        if (expected.Polygon is not null && path.Edges.SingleOrDefault() is Hatch.BoundaryPath.Polyline polyline)
        {
            if (!polyline.IsClosed || polyline.HasBulge || polyline.Bulges.Any(bulge => !Zero(bulge)) || !path.Flags.HasFlag(BoundaryPathFlags.Polyline) || polyline.Vertices.Count != expected.Polygon.Count) failures.Add($"hatch {id} polygon closure/bulge/point count changed");
            for (var index = 0; index < Math.Min(polyline.Vertices.Count, expected.Polygon.Count); index++) Point(expected.Polygon[index], polyline.Vertices[index], id, $"hatch polygon point {index}", failures);
        }
        else if (expected.CircleCenter is CadPoint center && path.Edges.SingleOrDefault() is Hatch.BoundaryPath.Arc arc)
        {
            Point(center, arc.Center, id, "hatch circle center", failures);
            Near(expected.CircleRadius!.Value, arc.Radius, id, "hatch circle radius", failures);
            Near(0, arc.StartAngle, id, "hatch circle start", failures, AngularTolerance);
            Near(MathHelper.TwoPI, arc.EndAngle, id, "hatch circle end", failures, AngularTolerance);
            if (!arc.CounterClockWise) failures.Add($"hatch {id} circular boundary is not counterclockwise");
        }
        else failures.Add($"hatch {id} boundary type changed");
    }

    private static void CompareDimension(NativeEntity source, NativeDimension expected, DimensionAligned dimension, IReadOnlyDictionary<string, IReadOnlyList<string>> expectedChildren, ICollection<string> failures)
    {
        var id = source.Id;
        Point(expected.Start, dimension.FirstPoint, id, "dimension first point", failures);
        Point(expected.End, dimension.SecondPoint, id, "dimension second point", failures);
        Point(expected.DimensionLinePoint, dimension.DefinitionPoint, id, "dimension definition point", failures);
        Point(expected.TextPosition, dimension.TextMiddlePoint, id, "dimension text position", failures);
        Near(expected.Measurement, dimension.Measurement, id, "dimension measurement", failures);
        if (!string.IsNullOrEmpty(dimension.Text) && dimension.Text != "<>") failures.Add($"dimension {id} has an overridden measured value");
        if (!dimension.IsTextUserDefinedLocation || !double.IsFinite(dimension.TextRotation) || Math.Abs(dimension.TextRotation) > AngularTolerance) failures.Add($"dimension {id} text placement semantics changed");
        if (dimension.Style.DecimalPlaces != 1 || dimension.Style.Suffix != expected.Suffix || dimension.Style.Style?.Filename != "NotoSansKR-Regular.ttf") failures.Add($"dimension {id} style precision/suffix/font changed");
        if (dimension.Style.ZeroHandling != (ZeroHandling)0 || !NearValue(expected.FontSize, dimension.Style.ArrowSize) || !NearValue(1, dimension.Style.ScaleFactor) || !NearValue(0.625, dimension.Style.ExtensionLineOffset) || !NearValue(1.25, dimension.Style.ExtensionLineExtension))
            failures.Add($"dimension {id} style geometry changed");
        Near(expected.FontSize, dimension.Style.TextHeight, id, "dimension text height", failures);
        var expectedColor = NativeDwgWriter.ColorFromHex(source.Style.Stroke!);
        CompareColor(id, dimension.Style.TextColor, expectedColor, failures, "dimension text color");
        CompareColor(id, dimension.Style.DimensionLineColor, expectedColor, failures, "dimension line color");
        CompareColor(id, dimension.Style.ExtensionLineColor, expectedColor, failures, "dimension extension line color");
        var expectedWeight = NativeDwgWriter.QuantizeLineweight(source.Style.RequestedPaperLineweight);
        if (dimension.Style.DimensionLineWeight != expectedWeight || dimension.Style.ExtensionLineWeight != expectedWeight) failures.Add($"dimension {id} lineweight changed");
        Vector(XYZ.AxisZ, dimension.Normal, id, "dimension normal", failures);
        var expectedText = expected.Measurement.ToString("F1", CultureInfo.InvariantCulture) + expected.Suffix;
        if (dimension.GetMeasurementText() != expectedText) failures.Add($"dimension {id} generated measurement text changed");

        var points = dimension.Block.Entities.OfType<ACadSharp.Entities.Point>().ToArray();
        var lines = dimension.Block.Entities.OfType<Line>().ToArray();
        var arrows = dimension.Block.Entities.OfType<Solid>().ToArray();
        var texts = dimension.Block.Entities.OfType<MText>().ToArray();
        if (points.Length != 4 || lines.Length != 3 || arrows.Length != 2 || texts.Length != 1 || dimension.Block.Entities.Count() != 10)
        {
            failures.Add($"dimension {id} child shape changed");
            return;
        }
        if (!expectedChildren.TryGetValue(id, out var handles))
            failures.Add($"dimension {id} missing expected child handle mapping");
        else
        {
            var actualHandles = dimension.Block.Entities.Select(entity => Handle(entity.Handle)).ToArray();
            if (!handles.SequenceEqual(actualHandles, StringComparer.Ordinal)) failures.Add($"dimension {id} generated child handles changed");
        }
        foreach (var child in dimension.Block.Entities)
        {
            if (!ReferenceEquals(child.Owner, dimension.Block)) failures.Add($"dimension {id} child owner changed");
            if (child.Layer?.Name != "0") failures.Add($"dimension {id} child layer changed");
            if (!child.Color.IsByBlock) failures.Add($"dimension {id} child color changed");
            if (child.LineWeight != LineWeightType.ByBlock) failures.Add($"dimension {id} child lineweight changed");
            if (child.IsInvisible || !NearValue(1, child.LineTypeScale) || child.LineType?.Name != "ByLayer") failures.Add($"dimension {id} child rendering state changed");
        }
        var start = expected.Start;
        var end = expected.End;
        var displayEnd = expected.DimensionLinePoint;
        var displayStart = new CadPoint(start.X + displayEnd.X - end.X, start.Y + displayEnd.Y - end.Y);
        foreach (var point in new[] { start, end, displayStart, displayEnd })
            if (!points.Any(child => PointEquals(point, child.Location))) failures.Add($"dimension {id} generated definition point changed");
        RequireLine(lines, displayStart, displayEnd, id, "dimension line", failures);
        var offsetX = displayStart.X - start.X;
        var offsetY = displayStart.Y - start.Y;
        var offsetLength = Math.Sqrt(offsetX * offsetX + offsetY * offsetY);
        var nx = offsetLength == 0 ? 0 : offsetX / offsetLength;
        var ny = offsetLength == 0 ? 1 : offsetY / offsetLength;
        RequireLine(lines, new CadPoint(start.X + nx * 0.625, start.Y + ny * 0.625), new CadPoint(displayStart.X + nx * 1.25, displayStart.Y + ny * 1.25), id, "first extension line", failures);
        RequireLine(lines, new CadPoint(end.X + nx * 0.625, end.Y + ny * 0.625), new CadPoint(displayEnd.X + nx * 1.25, displayEnd.Y + ny * 1.25), id, "second extension line", failures);
        var length = expected.Measurement;
        var ux = (end.X - start.X) / length;
        var uy = (end.Y - start.Y) / length;
        var px = -uy;
        var py = ux;
        RequireArrow(arrows, displayStart, ux, uy, px, py, expected.FontSize, id, failures);
        RequireArrow(arrows, displayEnd, -ux, -uy, px, py, expected.FontSize, id, failures);
        foreach (var line in lines) Planar(line.Normal, line.Thickness, id, "dimension child line", failures);
        foreach (var arrow in arrows) Planar(arrow.Normal, arrow.Thickness, id, "dimension child arrow", failures);
        var text = texts[0];
        Point(expected.TextPosition, text.InsertPoint, id, "dimension child text position", failures);
        if (text.PlainText != expectedText || text.AttachmentPoint != AttachmentPointType.TopLeft || !double.IsFinite(text.Rotation) || Math.Abs(text.Rotation) > AngularTolerance || !PointEquals(new CadPoint(1, 0), text.AlignmentPoint) || !NearValue(expected.FontSize, text.Height) || text.Style?.Filename != "NotoSansKR-Regular.ttf" || !text.Color.IsByBlock || !VectorEquals(XYZ.AxisZ, text.Normal))
            failures.Add($"dimension {id} child text content/anchor/orientation/font changed");
    }

    private static IReadOnlyList<NativeLayoutReadBack> VerifyLayouts(NativeCanvas canvas, CadDocument actual, ICollection<string> failures)
    {
        var paperLayouts = actual.Layouts.Where(layout => layout.IsPaperSpace).ToArray();
        if (paperLayouts.Length != 1) failures.Add($"paper layout count is {paperLayouts.Length}, expected 1");
        var records = new List<NativeLayoutReadBack>();
        foreach (var layout in paperLayouts)
        {
            if (layout.PaperUnits != PlotPaperUnits.Millimeters) failures.Add("paper layout units are not millimeters");
            Near(canvas.OutputProfile.Width, layout.PaperWidth, "layout", "paper width", failures);
            Near(canvas.OutputProfile.Height, layout.PaperHeight, "layout", "paper height", failures);
            var viewports = layout.Viewports.Select(viewport => (object)new
            {
                handle = Handle(viewport.Handle),
                viewport.Id,
                viewport.RepresentsPaper,
                center = new { viewport.Center.X, viewport.Center.Y },
                viewport.Width,
                viewport.Height,
                viewCenter = new { viewport.ViewCenter.X, viewport.ViewCenter.Y },
                viewport.ViewHeight,
                scaleFactor = double.IsFinite(viewport.ScaleFactor) ? viewport.ScaleFactor : (double?)null,
            }).ToArray();
            var modelViewports = layout.Viewports.Where(viewport => !viewport.RepresentsPaper).ToArray();
            if (modelViewports.Length != 1) failures.Add($"actual model viewport count is {modelViewports.Length}, expected 1");
            else
            {
                var viewport = modelViewports[0];
                Point(canvas.Viewport.PaperCenter, viewport.Center, "layout", "viewport paper center", failures);
                Point(canvas.Viewport.ViewCenter, viewport.ViewCenter, "layout", "viewport model center", failures);
                Near(canvas.OutputProfile.Width, viewport.Width, "layout", "viewport width", failures);
                Near(canvas.OutputProfile.Height, viewport.Height, "layout", "viewport height", failures);
                Near(canvas.Viewport.ViewHeight, viewport.ViewHeight, "layout", "viewport view height", failures);
                Near(canvas.Viewport.Scale, viewport.Height / viewport.ViewHeight, "layout", "viewport scale", failures);
                if (!double.IsFinite(viewport.ScaleFactor)) failures.Add("viewport native ScaleFactor is not finite");
            }
            records.Add(new NativeLayoutReadBack(layout.Name, layout.PaperWidth, layout.PaperHeight, layout.PaperUnits.ToString(), viewports));
        }
        return records;
    }

    private static void CompareColor(string id, Color actual, Color expected, ICollection<string> failures, string label = "RGB color")
    {
        if (!actual.IsTrueColor || actual.R != expected.R || actual.G != expected.G || actual.B != expected.B) failures.Add($"entity {id} {label} changed");
    }

    private static void CompareEntityState(NativeEntity source, Entity entity, ICollection<string> failures)
    {
        if (entity.IsInvisible || !NearValue(1, entity.LineTypeScale) || entity.LineType?.Name != "ByLayer") failures.Add($"entity {source.Id} common rendering state changed");
    }

    private static void Planar(XYZ normal, double thickness, string id, string label, ICollection<string> failures)
    {
        if (!VectorEquals(XYZ.AxisZ, normal)) failures.Add($"{label} {id} normal changed");
        if (!Zero(thickness)) failures.Add($"{label} {id} thickness changed");
    }

    private static void Vector(XYZ expected, XYZ actual, string id, string label, ICollection<string> failures)
    {
        if (!VectorEquals(expected, actual)) failures.Add($"{label} {id} changed");
    }

    private static bool VectorEquals(XYZ expected, XYZ actual) =>
        Math.Abs(expected.X - actual.X) <= GeometryTolerance && Math.Abs(expected.Y - actual.Y) <= GeometryTolerance && Math.Abs(expected.Z - actual.Z) <= GeometryTolerance;
    private static bool NearValue(double expected, double actual) => double.IsFinite(actual) && Math.Abs(expected - actual) <= GeometryTolerance;
    private static bool Zero(double actual) => NearValue(0, actual);

    private static void RequireArrow(IEnumerable<Solid> arrows, CadPoint tip, double ux, double uy, double px, double py, double size, string id, ICollection<string> failures)
    {
        var half = size / 6;
        var second = new CadPoint(tip.X + ux * size + px * half, tip.Y + uy * size + py * half);
        var third = new CadPoint(tip.X + ux * size - px * half, tip.Y + uy * size - py * half);
        if (!arrows.Any(arrow => PointEquals(tip, arrow.FirstCorner) && PointEquals(second, arrow.SecondCorner) && PointEquals(third, arrow.ThirdCorner) && PointEquals(third, arrow.FourthCorner)))
            failures.Add($"dimension {id} arrow corner changed");
    }

    private static void RequireLine(IEnumerable<Line> lines, CadPoint start, CadPoint end, string id, string label, ICollection<string> failures)
    {
        if (!lines.Any(line => PointEquals(start, line.StartPoint) && PointEquals(end, line.EndPoint))) failures.Add($"dimension {id} {label} endpoints changed");
    }

    private static void Point(CadPoint expected, XYZ actual, string id, string label, ICollection<string> failures)
    {
        if (!PointEquals(expected, actual)) failures.Add($"entity {id} {label} changed");
    }
    private static void Point(CadPoint expected, XY actual, string id, string label, ICollection<string> failures)
    {
        if (!PointEquals(expected, actual)) failures.Add($"entity {id} {label} changed");
    }
    private static bool PointEquals(CadPoint expected, XYZ actual) => Math.Abs(expected.X - actual.X) <= GeometryTolerance && Math.Abs(expected.Y - actual.Y) <= GeometryTolerance && Math.Abs(actual.Z) <= GeometryTolerance;
    private static bool PointEquals(CadPoint expected, XY actual) => Math.Abs(expected.X - actual.X) <= GeometryTolerance && Math.Abs(expected.Y - actual.Y) <= GeometryTolerance;
    private static void Near(double expected, double actual, string id, string label, ICollection<string> failures, double tolerance = GeometryTolerance)
    {
        if (!double.IsFinite(actual) || Math.Abs(expected - actual) > tolerance) failures.Add($"entity {id} {label} is {actual:R}, expected {expected:R}");
    }
    private static void Angle(double expected, double actual, string id, string label, ICollection<string> failures)
    {
        var difference = (actual - expected) % MathHelper.TwoPI;
        if (difference > Math.PI) difference -= MathHelper.TwoPI;
        if (difference < -Math.PI) difference += MathHelper.TwoPI;
        if (!double.IsFinite(actual) || Math.Abs(difference) > AngularTolerance) failures.Add($"entity {id} {label} changed");
    }
    private static string NormalizeNewlines(string value) => value.Replace("\r\n", "\n", StringComparison.Ordinal).Replace("\r", "\n", StringComparison.Ordinal);
    private static string TypeName(NativeGeometry geometry) => geometry switch
    {
        NativeLine => "LINE", NativePolyline => "LWPOLYLINE", NativeCircle => "CIRCLE", NativeArc => "ARC",
        NativeText => "MTEXT", NativeDimension => "DIMENSION", NativeHatch => "HATCH", NativeInsert => "INSERT",
        _ => throw new InvalidOperationException($"Unsupported geometry type {geometry.Type}.")
    };
    private static string Geometry(Entity entity) => entity switch
    {
        Line line => $"start={PointText(line.StartPoint)};end={PointText(line.EndPoint)}",
        LwPolyline polyline => $"closed={polyline.IsClosed};points={string.Join("/", polyline.Vertices.Select(vertex => PointText(vertex.Location)))}",
        Arc arc => $"center={PointText(arc.Center)};radius={arc.Radius:R};start={arc.StartAngle:R};end={arc.EndAngle:R}",
        Circle circle => $"center={PointText(circle.Center)};radius={circle.Radius:R}",
        MText text => $"origin={PointText(text.InsertPoint)};height={text.Height:R};width={text.RectangleWidth:R};rotation={text.Rotation:R};text={text.PlainText}",
        Insert insert => $"block={insert.Block?.Name};origin={PointText(insert.InsertPoint)};scale={insert.XScale:R},{insert.YScale:R},{insert.ZScale:R};rotation={insert.Rotation:R}",
        Hatch hatch => $"solid={hatch.IsSolid};associative={hatch.IsAssociative};paths={hatch.Paths.Count};transparency={hatch.Transparency.Value}",
        DimensionAligned dimension => $"first={PointText(dimension.FirstPoint)};second={PointText(dimension.SecondPoint)};definition={PointText(dimension.DefinitionPoint)};measurement={dimension.Measurement:R};text={dimension.GetMeasurementText()}",
        _ => entity.ObjectName,
    };
    private static string PointText(XYZ value) => $"{value.X:R},{value.Y:R},{value.Z:R}";
    private static string PointText(XY value) => $"{value.X:R},{value.Y:R}";
    private static string Handle(ulong handle) => handle.ToString("X", CultureInfo.InvariantCulture);
}
