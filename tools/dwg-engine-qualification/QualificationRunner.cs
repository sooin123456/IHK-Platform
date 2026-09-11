using System.Globalization;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text.Json;
using ACadSharp;
using ACadSharp.Blocks;
using ACadSharp.Entities;
using ACadSharp.IO;
using ACadSharp.Objects;
using ACadSharp.Tables;
using ACadSharp.Types.Units;
using CSMath;

namespace DwgEngineQualification;

internal sealed record InputEvidence(
    string Path,
    string Sha256Before,
    string Sha256WorkingCopy,
    string Sha256After,
    bool OriginalBytesPreserved);

internal sealed record ToleranceEvidence(double GeometryNumericAbsolute);

internal sealed record EngineEvidence(
    string Package,
    string PinnedVersion,
    string AssemblyVersion,
    string Framework,
    string License,
    string ReleaseUrl,
    string SourceUrl);

internal sealed record RoundTripEvidence(
    string Name,
    string OutputPath,
    string OutputSha256,
    int BeforeEntityCount,
    int AfterEntityCount,
    IReadOnlyList<string> ExpectedEditedHandles,
    IReadOnlyList<string> Failures,
    IReadOnlyList<string> Diagnostics);

internal sealed record QualificationRunReport(
    string Status,
    string InternalSyntheticResult,
    string ProductionDwgDeliveryQualification,
    string IndependentCadVerification,
    string GeneratedAtUtc,
    EngineEvidence Engine,
    ToleranceEvidence Tolerances,
    InputEvidence Input,
    CadInventory BaselineInventory,
    CadInventory NoEditInventory,
    CadInventory? EditedInventory,
    RoundTripEvidence NoEditRoundTrip,
    RoundTripEvidence? EditedRoundTrip,
    DwgEditRequestEvidence? EditRequest,
    IReadOnlyList<string> Warnings);

internal static class QualificationRunner
{
    private const double CoordinateTolerance = 1e-9;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public static int CreateGeneratedFixture(string outputDirectory, TextWriter output, TextWriter error)
    {
        try
        {
            var directory = Path.GetFullPath(outputDirectory);
            if (File.Exists(directory)) throw new ArgumentException("Output directory resolves to a file.");
            var path = QualificationPaths.BoundedOutputPath(directory, "synthetic-input.dwg");
            if (File.Exists(path) || Directory.Exists(path) || new FileInfo(path).LinkTarget is not null)
                throw new IOException($"Refusing to overwrite existing fixture or symbolic link: {path}");
            Directory.CreateDirectory(directory);

            var diagnostics = new List<string>();
            var document = CreateFixtureDocument();
            WriteDocument(path, document, diagnostics);
            var reread = ReadDocument(path, diagnostics);
            var inventory = Inventory(reread, diagnostics);
            RejectExternalReferences(inventory);

            output.WriteLine(path);
            output.WriteLine($"generated entities={inventory.Entities.Count} sha256={HashFile(path)}");
            foreach (var message in diagnostics) output.WriteLine($"diagnostic: {message}");
            return 0;
        }
        catch (Exception exception)
        {
            error.WriteLine($"fixture generation failed: {exception.GetType().Name}: {exception.Message}");
            return 1;
        }
    }

    public static int Qualify(string inputPath, string outputDirectory, TextWriter output, TextWriter error, string? editsPath = null)
    {
        QualificationPaths paths;
        SelectedDwgEdits? requestedEdits;
        try
        {
            paths = QualificationPaths.Create(inputPath, outputDirectory);
            EnsureOutputsAbsent(paths);
            requestedEdits = editsPath is null ? null : SelectedDwgEdits.Load(editsPath);
            Directory.CreateDirectory(paths.OutputDirectory);
        }
        catch (Exception exception)
        {
            error.WriteLine($"qualification rejected: {exception.GetType().Name}: {exception.Message}");
            return 2;
        }

        var baselineDiagnostics = new List<string>();
        var noEditDiagnostics = new List<string>();
        var editDiagnostics = new List<string>();
        var beforeHash = "unavailable";
        var copyHash = "unavailable";

        try
        {
            beforeHash = HashFile(paths.InputPath);
            File.Copy(paths.InputPath, paths.WorkingCopyPath, overwrite: false);
            copyHash = HashFile(paths.WorkingCopyPath);
            if (beforeHash != copyHash) throw new InvalidDataException("DWG input changed while copying.");
            var baselineDocument = ReadDocument(paths.WorkingCopyPath, baselineDiagnostics);
            var baseline = Inventory(baselineDocument, baselineDiagnostics);
            RejectExternalReferences(baseline);

            CadDocument? editDocument = null;
            CadInventory? expectedEdited = null;
            if (requestedEdits is not null)
            {
                editDocument = ReadDocument(paths.WorkingCopyPath, editDiagnostics);
                requestedEdits.Apply(editDocument, copyHash);
                expectedEdited = Inventory(editDocument, editDiagnostics);
                using var requestOutput = new FileStream(paths.EditRequestPath, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                requestOutput.Write(requestedEdits.Bytes);
            }

            WriteDocument(paths.NoEditDwgPath, baselineDocument, noEditDiagnostics);
            var noEditDocument = ReadDocument(paths.NoEditDwgPath, noEditDiagnostics);
            var noEdit = Inventory(noEditDocument, noEditDiagnostics);
            var noEditComparison = SemanticComparer.Compare(
                baseline, noEdit, ExpectedEdits.None, CoordinateTolerance);

            CadInventory? edited = null;
            var editFailures = new List<string>();
            if (editDocument is not null)
            {
                WriteDocument(paths.EditedDwgPath, editDocument, editDiagnostics);
                var editedDocument = ReadDocument(paths.EditedDwgPath, editDiagnostics);
                edited = Inventory(editedDocument, editDiagnostics);
                // Compare against exact requested values, not an exemption for all geometry on a selected handle.
                editFailures.AddRange(SemanticComparer.Compare(
                    expectedEdited!, edited, ExpectedEdits.None, CoordinateTolerance).Failures);
            }

            var afterHash = HashFile(paths.InputPath);
            var inputPreserved = HashesMatch(beforeHash, copyHash, afterHash) && HashFile(paths.WorkingCopyPath) == copyHash;
            if (!inputPreserved) editFailures.Add("input bytes or working-copy hash changed");

            var allFailures = noEditComparison.Failures.Concat(editFailures).ToArray();
            var hasInventoryGaps = baseline.Diagnostics?.Any(
                diagnostic => diagnostic.StartsWith("unsupported inventory fields", StringComparison.Ordinal)
                    || diagnostic.StartsWith("duplicate entity handle", StringComparison.Ordinal)) == true;
            var report = new QualificationRunReport(
                "experimental",
                allFailures.Length > 0 ? "failed" : hasInventoryGaps ? "passed-with-inventory-gaps" : "passed",
                "not-qualified",
                "not-performed",
                DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture),
                Engine(),
                new ToleranceEvidence(CoordinateTolerance),
                new InputEvidence(paths.InputPath, beforeHash, copyHash, afterHash, inputPreserved),
                baseline,
                noEdit,
                edited,
                new RoundTripEvidence(
                    "no-edit", paths.NoEditDwgPath, HashFile(paths.NoEditDwgPath), baseline.Entities.Count, noEdit.Entities.Count,
                    [], noEditComparison.Failures, noEditDiagnostics),
                edited is null ? null : new RoundTripEvidence(
                    "selected-handle-edits", paths.EditedDwgPath, HashFile(paths.EditedDwgPath), baseline.Entities.Count, edited.Entities.Count,
                    requestedEdits!.Evidence.Handles, editFailures, editDiagnostics),
                requestedEdits?.Evidence,
                baselineDiagnostics.Concat(new[]
                {
                    "Input provenance and edit request authorization are not authenticated by this internal CLI.",
                    "Synthetic ACadSharp-generated input is circular internal evidence only.",
                    "Independent CAD open/save/visual verification was not performed.",
                    "This run does not qualify production DWG re-save or customer delivery.",
                    "Common appearance, attributes, viewport/layout settings, and extended data are not fully inventoried.",
                    "External references are rejected and no referenced path or URL is followed.",
                }).ToArray());

            File.WriteAllText(paths.ReportPath, JsonSerializer.Serialize(report, JsonOptions));
            output.WriteLine(paths.ReportPath);
            output.WriteLine($"internal-synthetic={report.InternalSyntheticResult} production={report.ProductionDwgDeliveryQualification}");
            output.WriteLine($"no-edit failures={noEditComparison.Failures.Count}; edit failures={(edited is null ? "not-requested" : editFailures.Count.ToString(CultureInfo.InvariantCulture))}");
            return allFailures.Length == 0 ? 0 : 1;
        }
        catch (Exception exception)
        {
            var afterHash = TryHashFile(paths.InputPath);
            var failure = new
            {
                status = "experimental",
                internalSyntheticResult = "failed",
                productionDwgDeliveryQualification = "not-qualified",
                independentCadVerification = "not-performed",
                engine = Engine(),
                tolerances = new ToleranceEvidence(CoordinateTolerance),
                input = new InputEvidence(paths.InputPath, beforeHash, copyHash, afterHash, HashesMatch(beforeHash, copyHash, afterHash)),
                error = new { type = exception.GetType().FullName, exception.Message, exception.StackTrace },
                diagnostics = new { baselineDiagnostics, noEditDiagnostics, editDiagnostics },
            };
            error.WriteLine($"qualification failed: {exception.GetType().Name}: {exception.Message}");
            try
            {
                File.WriteAllText(paths.ReportPath, JsonSerializer.Serialize(failure, JsonOptions));
                error.WriteLine($"failure report: {paths.ReportPath}");
            }
            catch (Exception reportException)
            {
                error.WriteLine($"failure report unavailable: {reportException.GetType().Name}: {reportException.Message}");
            }
            return exception is InvalidDataException ? 2 : 1;
        }
    }

    private static CadDocument CreateFixtureDocument()
    {
        var document = new CadDocument(ACadVersion.AC1024);
        document.Header.InsUnits = UnitsType.Millimeters;

        var geometryLayer = new Layer("QA_GEOMETRY");
        var textLayer = new Layer("QA_TEXT");
        document.Layers.Add(geometryLayer);
        document.Layers.Add(textLayer);

        document.Entities.Add(new Line(new XYZ(0, 0, 0), new XYZ(100, 0, 0)) { Layer = geometryLayer });
        document.Entities.Add(new Circle(new XYZ(25, 25, 0), 10) { Layer = geometryLayer });
        document.Entities.Add(new Arc(new XYZ(50, 25, 0), 12, 0.25, 2.5) { Layer = geometryLayer });
        document.Entities.Add(new LwPolyline(new[]
        {
            new XY(0, 10), new XY(15, 18), new XY(30, 10), new XY(0, 10),
        })
        { Layer = geometryLayer, IsClosed = true });
        document.Entities.Add(new TextEntity
        {
            InsertPoint = new XYZ(5, 40, 0),
            Height = 2.5,
            Value = "SYNTHETIC QA TEXT",
            Layer = textLayer,
        });

        var block = new BlockRecord("QA_ORDINARY_BLOCK");
        block.Entities.Add(new Line(new XYZ(0, 0, 0), new XYZ(8, 0, 0)) { Layer = geometryLayer });
        block.Entities.Add(new Circle(new XYZ(4, 4, 0), 2) { Layer = geometryLayer });
        document.BlockRecords.Add(block);
        document.Entities.Add(new Insert(block)
        {
            InsertPoint = new XYZ(70, 30, 0),
            XScale = 1.5,
            YScale = 1.5,
            ZScale = 1,
            Rotation = 0.2,
            Layer = geometryLayer,
        });

        return document;
    }

    private static CadDocument ReadDocument(string path, ICollection<string> diagnostics)
    {
        using var stream = File.OpenRead(path);
        return ReadDocument(stream, message => diagnostics.Add($"reader: {message}"));
    }

    internal static CadDocument ReadDocument(Stream stream, Action<string> notification)
    {
        using var reader = new DwgReader(stream);
        reader.Configuration.Failsafe = false;
        reader.Configuration.KeepUnknownEntities = true;
        reader.Configuration.KeepUnknownNonGraphicalObjects = true;
        reader.OnNotification += (_, item) => notification(item.Message);
        return reader.Read();
    }

    internal static void RejectUnwritableObjects(CadDocument document)
    {
        // ACadSharp 3.7.1 exposes lookup by handle but no public registry enumeration.
        // Scan its verified registry, not only root/block collections: extension
        // dictionaries, table objects and owned entities may also retain unknowns.
        var pending = new Stack<CadObject>(RetainedObjects(document).Values.OfType<CadObject>());
        var visited = new HashSet<CadObject>(ReferenceEqualityComparer.Instance);
        while (pending.TryPop(out var item))
        {
            if (!visited.Add(item)) continue;
            if (item is UnknownEntity or UnknownNonGraphicalObject)
                throw new InvalidDataException("DWG v2 edits reject retained unknown graphical or non-graphical objects.");
            if (item is LwPolyline polyline && polyline.Vertices.Any(vertex => vertex.Id != 0))
                throw new InvalidDataException("DWG v2 edits reject retained polyline vertex identifiers that the pinned writer discards.");
            // Also follow reachable attachments; identity tracking bounds cycles.
            if (item.XDictionary is not null) pending.Push(item.XDictionary);
            foreach (var reactor in item.Reactors) pending.Push(reactor);
            if (item is CadDictionary dictionary)
                foreach (var value in dictionary) pending.Push(value);
        }
    }

    private static IReadOnlyDictionary<ulong, IHandledCadObject> RetainedObjects(CadDocument document)
    {
        try
        {
            return RegisteredObjects(document)
                ?? throw new InvalidDataException("The pinned DWG object registry is unavailable.");
        }
        catch (Exception exception) when (exception is MemberAccessException or TypeLoadException)
        {
            throw new InvalidDataException("The pinned DWG object registry cannot be inspected; v2 writing is disabled.", exception);
        }
    }

    // Exact ACadSharp 3.7.1 field type. Access/shape changes fail closed above;
    // no reflection or scan over potentially sparse, unbounded handle numbers.
    [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_cadObjects")]
    private static extern ref Dictionary<ulong, IHandledCadObject> RegisteredObjects(CadDocument document);

    private static void WriteDocument(string path, CadDocument document, ICollection<string> diagnostics)
    {
        using var stream = new FileStream(path, FileMode.Create, FileAccess.Write);
        WriteDocument(stream, document, message => diagnostics.Add($"writer: {message}"));
    }

    internal static void WriteDocument(Stream stream, CadDocument document, Action<string> notification)
    {
        using var writer = new DwgWriter(stream, document);
        writer.OnNotification += (_, item) => notification(item.Message);
        writer.Write();
    }

    internal static CadInventory Inventory(CadDocument document, ICollection<string> diagnostics)
    {
        var entityDiagnostics = new List<string>();
        var entityGroups = document.BlockRecords
            .SelectMany(block => block.Entities)
            .GroupBy(entity => entity.Handle)
            .ToArray();
        foreach (var duplicate in entityGroups.Where(group => group.Count() > 1))
            entityDiagnostics.Add($"duplicate entity handle {Handle(duplicate.Key)} occurs {duplicate.Count()} times");
        var entities = entityGroups
            .SelectMany(group => group)
            .OrderBy(entity => entity.Handle)
            .Select(entity => InventoryEntity(entity, entityDiagnostics))
            .ToArray();
        foreach (var message in entityDiagnostics) diagnostics.Add(message);

        var blocks = document.BlockRecords
            .OrderBy(block => block.Name, StringComparer.Ordinal)
            .Select(block => new BlockInventory(
                Handle(block.Handle),
                block.Name,
                block.Layout?.Name,
                block.Units.ToString(),
                block.BlockEntity.Flags.ToString(),
                string.IsNullOrWhiteSpace(block.BlockEntity.XRefPath) ? null : block.BlockEntity.XRefPath,
                block.Entities.Select(entity => Handle(entity.Handle)).OrderBy(handle => handle, StringComparer.Ordinal).ToArray()))
            .ToArray();

        var layouts = (document.Layouts is null
                ? Enumerable.Empty<ACadSharp.Objects.Layout>()
                : document.Layouts.AsEnumerable())
            .OrderBy(layout => layout.Name, StringComparer.Ordinal)
            .Select(layout => new LayoutInventory(
                Handle(layout.Handle), layout.Name, layout.AssociatedBlock?.Name ?? "<missing>"))
            .ToArray();

        var styles = document.TextStyles
            .OrderBy(style => style.Name, StringComparer.Ordinal)
            .Select(style => new TextStyleInventory(
                Handle(style.Handle), style.Name, style.Filename ?? string.Empty, style.BigFontFilename ?? string.Empty))
            .ToArray();

        return new CadInventory(
            entities,
            document.Header.InsUnits.ToString(),
            document.Header.VersionString,
            document.Layers.Select(layer => $"{Handle(layer.Handle)}|{layer.Name}").OrderBy(value => value, StringComparer.Ordinal).ToArray(),
            blocks,
            layouts,
            styles,
            entityDiagnostics);
    }

    internal static EntityInventory InventoryEntity(Entity entity, ICollection<string> diagnostics)
    {
        var geometry = entity switch
        {
            Line line => $"start={Point(line.StartPoint)};end={Point(line.EndPoint)};thickness={Number(line.Thickness)};normal={Point(line.Normal)}",
            Arc arc => $"center={Point(arc.Center)};radius={Number(arc.Radius)};startAngle={Number(arc.StartAngle)};endAngle={Number(arc.EndAngle)};thickness={Number(arc.Thickness)};normal={Point(arc.Normal)}",
            Circle circle => $"center={Point(circle.Center)};radius={Number(circle.Radius)};thickness={Number(circle.Thickness)};normal={Point(circle.Normal)}",
            LwPolyline polyline => $"closed={polyline.IsClosed};flags={polyline.Flags};elevation={Number(polyline.Elevation)};normal={Point(polyline.Normal)};thickness={Number(polyline.Thickness)};constantWidth={Number(polyline.ConstantWidth)};vertices={string.Join("/", polyline.Vertices.Select(vertex => $"{Point(vertex.Location)}:{Number(vertex.Bulge)}:{Number(vertex.StartWidth)}:{Number(vertex.EndWidth)}"))}",
            TextEntity text => $"insert={Point(text.InsertPoint)};alignment={Point(text.AlignmentPoint)};normal={Point(text.Normal)};height={Number(text.Height)};rotation={Number(text.Rotation)};horizontal={text.HorizontalAlignment};vertical={text.VerticalAlignment};oblique={Number(text.ObliqueAngle)};widthFactor={Number(text.WidthFactor)};mirror={text.Mirror};thickness={Number(text.Thickness)};style={text.Style?.Name}",
            Insert insert => InventoryInsert(insert, diagnostics),
            Viewport viewport => InventoryViewport(viewport),
            _ => UnsupportedGeometry(entity, diagnostics),
        };

        return new EntityInventory(
            Handle(entity.Handle),
            entity.ObjectName,
            entity.Owner is null ? "0" : Handle(entity.Owner.Handle),
            entity.Layer?.Name ?? "<missing>",
            geometry,
            entity is TextEntity textEntity ? textEntity.Value : null,
            entity switch
            {
                TextEntity text when text.Style is not null => $"{Handle(text.Style.Handle)}:{text.Style.Name}",
                Insert insert when insert.Block is not null => $"{Handle(insert.Block.Handle)}:{insert.Block.Name}",
                Viewport viewport => JsonSerializer.Serialize(new
                {
                    viewport.StyleSheetName,
                    boundary = viewport.Boundary is null ? null : Handle(viewport.Boundary.Handle),
                    frozenLayers = viewport.FrozenLayers.Select(layer => $"{Handle(layer.Handle)}:{layer.Name}").Order(StringComparer.Ordinal).ToArray(),
                    visualStyle = viewport.VisualStyle is null ? null : Handle(viewport.VisualStyle.Handle),
                    scale = viewport.Scale is null ? null : $"{Handle(viewport.Scale.Handle)}:{viewport.Scale.Name}",
                }),
                _ => null,
            });
    }

    private static string InventoryViewport(Viewport viewport)
    {
        // Intrinsic fields only: default paper viewports have undefined derived scale/width.
        // References and plot names are in the exact Reference field, never numeric-tolerant geometry.
        var values = new[]
        {
            viewport.Center.X, viewport.Center.Y, viewport.Center.Z, viewport.Width, viewport.Height,
            viewport.ViewCenter.X, viewport.ViewCenter.Y, viewport.ViewHeight,
            viewport.ViewDirection.X, viewport.ViewDirection.Y, viewport.ViewDirection.Z,
            viewport.ViewTarget.X, viewport.ViewTarget.Y, viewport.ViewTarget.Z,
            viewport.TwistAngle, viewport.FrontClipPlane, viewport.BackClipPlane, viewport.LensLength,
            viewport.UcsOrigin.X, viewport.UcsOrigin.Y, viewport.UcsOrigin.Z,
            viewport.UcsXAxis.X, viewport.UcsXAxis.Y, viewport.UcsXAxis.Z,
            viewport.UcsYAxis.X, viewport.UcsYAxis.Y, viewport.UcsYAxis.Z, viewport.Elevation,
            viewport.SnapAngle, viewport.SnapBase.X, viewport.SnapBase.Y,
            viewport.SnapSpacing.X, viewport.SnapSpacing.Y, viewport.GridSpacing.X, viewport.GridSpacing.Y,
            viewport.Brightness, viewport.Contrast,
        };
        if (values.Any(value => !double.IsFinite(value))) throw new InvalidDataException("DWG viewport inventory is non-finite.");
        return $"center={Point(viewport.Center)};width={Number(viewport.Width)};height={Number(viewport.Height)};"
            + $"viewCenter={Point(viewport.ViewCenter)};viewHeight={Number(viewport.ViewHeight)};viewDirection={Point(viewport.ViewDirection)};viewTarget={Point(viewport.ViewTarget)};"
            + $"twist={Number(viewport.TwistAngle)};frontClip={Number(viewport.FrontClipPlane)};backClip={Number(viewport.BackClipPlane)};lens={Number(viewport.LensLength)};"
            + $"id={viewport.Id};paper={viewport.RepresentsPaper};active={viewport.ActiveStatus};status={viewport.Status};"
            + $"ucsOrigin={Point(viewport.UcsOrigin)};ucsX={Point(viewport.UcsXAxis)};ucsY={Point(viewport.UcsYAxis)};ucsType={viewport.UcsOrthographicType};ucsPerViewport={viewport.UcsPerViewport};ucsIcon={viewport.DisplayUcsIcon};elevation={Number(viewport.Elevation)};"
            + $"snapAngle={Number(viewport.SnapAngle)};snapBase={Point(viewport.SnapBase)};snapSpacing={Point(viewport.SnapSpacing)};gridSpacing={Point(viewport.GridSpacing)};gridFrequency={viewport.MajorGridLineFrequency};circleZoom={viewport.CircleZoomPercent};"
            + $"shadePlot={viewport.ShadePlotMode};render={viewport.RenderMode};defaultLighting={viewport.UseDefaultLighting};lightingType={viewport.DefaultLightingType};brightness={Number(viewport.Brightness)};contrast={Number(viewport.Contrast)};ambient={viewport.AmbientLightColor}";
    }

    private static string InventoryInsert(Insert insert, ICollection<string> diagnostics)
    {
        if (insert.Attributes.Count > 0)
            diagnostics.Add($"unsupported inventory fields for INSERT handle {Handle(insert.Handle)}: attribute tags, values, geometry, and ownership");

        return $"block={insert.Block?.Name};insert={Point(insert.InsertPoint)};normal={Point(insert.Normal)};scale={Number(insert.XScale)},{Number(insert.YScale)},{Number(insert.ZScale)};rotation={Number(insert.Rotation)};rows={insert.RowCount}:{Number(insert.RowSpacing)};columns={insert.ColumnCount}:{Number(insert.ColumnSpacing)};attributes={insert.Attributes.Count}";
    }

    private static string UnsupportedGeometry(Entity entity, ICollection<string> diagnostics)
    {
        diagnostics.Add($"unsupported inventory fields for {entity.ObjectName} handle {Handle(entity.Handle)}");
        return $"unsupported-type={entity.GetType().FullName}";
    }

    private static void RejectExternalReferences(CadInventory inventory)
    {
        var external = (inventory.Blocks ?? [])
            .Where(block => !string.IsNullOrWhiteSpace(block.ExternalReferencePath)
                || block.Flags.Contains(nameof(BlockTypeFlags.XRef), StringComparison.Ordinal))
            .Select(block => block.Name)
            .ToArray();
        if (external.Length > 0)
            throw new InvalidOperationException($"External references are unsupported and were not followed: {string.Join(", ", external)}");
    }

    private static void EnsureOutputsAbsent(QualificationPaths paths)
    {
        foreach (var path in new[] { paths.WorkingCopyPath, paths.NoEditDwgPath, paths.EditedDwgPath, paths.ReportPath, paths.EditRequestPath })
            if (File.Exists(path) || Directory.Exists(path) || new FileInfo(path).LinkTarget is not null)
                throw new IOException($"Refusing to overwrite existing output or symbolic link: {path}");
    }

    private static EngineEvidence Engine()
    {
        var assembly = typeof(CadDocument).Assembly;
        return new EngineEvidence(
            "ACadSharp",
            "3.7.1",
            assembly.GetName().Version?.ToString() ?? "unknown",
            ".NET 8.0",
            "MIT",
            "https://github.com/DomCR/ACadSharp/releases/tag/v3.7.1",
            "https://github.com/DomCR/ACadSharp/tree/v3.7.1");
    }

    private static string HashFile(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    private static string TryHashFile(string path)
    {
        try
        {
            return HashFile(path);
        }
        catch
        {
            return "unavailable";
        }
    }

    private static bool HashesMatch(string before, string copy, string after) =>
        before != "unavailable"
        && copy != "unavailable"
        && after != "unavailable"
        && before == copy
        && before == after;

    private static string Handle(ulong handle) => handle.ToString("X", CultureInfo.InvariantCulture);
    private static string Number(double value) => value.ToString("R", CultureInfo.InvariantCulture);
    private static string Point(XYZ point) => $"{Number(point.X)},{Number(point.Y)},{Number(point.Z)}";
    private static string Point(XY point) => $"{Number(point.X)},{Number(point.Y)}";
}
