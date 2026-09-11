using System.Globalization;
using System.Security.Cryptography;
using System.Text;
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

internal sealed record NativeDwgBuild(
    CadDocument Document,
    IReadOnlyDictionary<string, Entity> Entities,
    IReadOnlyDictionary<string, BlockRecord> Blocks,
    IReadOnlyDictionary<string, IReadOnlyList<Entity>> DimensionChildren);

internal static class NativeDwgWriter
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };
    private static readonly int[] SupportedLineweights = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
    private const string ExpectedTableStyleNotification = "ACadSharp.Tables.TextStyle table reference with handle:  | name:  not found for ACadSharp.Objects.TableStyle+CellStyle";

    public static int Run(string inputPath, string outputDirectory, TextWriter output, TextWriter error)
    {
        NativeCadManifest manifest;
        string directory;
        string dwgPath;
        string sourcePath;
        string reportPath;
        try
        {
            var bounded = QualificationPaths.Create(inputPath, outputDirectory);
            directory = bounded.OutputDirectory;
            if (Directory.Exists(directory) || File.Exists(directory) || new DirectoryInfo(directory).LinkTarget is not null)
                throw new IOException("Output directory must be fresh and must not be a symbolic link.");
            dwgPath = QualificationPaths.BoundedOutputPath(directory, "native.dwg");
            sourcePath = QualificationPaths.BoundedOutputPath(directory, "source-manifest.json");
            reportPath = QualificationPaths.BoundedOutputPath(directory, "native-report.json");
            manifest = NativeCadManifest.Load(bounded.InputPath);
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidDataException or IOException or UnauthorizedAccessException or JsonException or DecoderFallbackException or KeyNotFoundException or InvalidOperationException or FormatException or OverflowException)
        {
            error.WriteLine($"native write rejected: {exception.GetType().Name}: {exception.Message}");
            return 2;
        }

        using (manifest)
        {
            var writerDiagnostics = new List<string>();
            var readerDiagnostics = new List<string>();
            var failures = new List<string>();
            try
            {
                Directory.CreateDirectory(directory);
                WriteExclusive(sourcePath, manifest.SourceBytes);
                var build = BuildDocument(manifest);
                using (var stream = new FileStream(dwgPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (var writer = new DwgWriter(stream, build.Document))
                {
                    writer.OnNotification += (_, notification) => writerDiagnostics.Add(notification.Message);
                    writer.Write();
                }

                var entityHandles = build.Entities.ToDictionary(pair => pair.Key, pair => Handle(pair.Value.Handle), StringComparer.Ordinal);
                var blockHandles = build.Blocks.ToDictionary(pair => pair.Key, pair => Handle(pair.Value.Handle), StringComparer.Ordinal);
                var dimensionChildHandles = build.DimensionChildren.ToDictionary(
                    pair => pair.Key,
                    pair => (IReadOnlyList<string>)pair.Value.Select(child => Handle(child.Handle)).ToArray(),
                    StringComparer.Ordinal);
                CadDocument actual;
                using (var stream = new FileStream(dwgPath, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var reader = new DwgReader(stream))
                {
                    reader.OnNotification += (_, notification) => readerDiagnostics.Add(notification.Message);
                    actual = reader.Read();
                }
                var verification = NativeDwgVerification.Compare(manifest, actual, entityHandles, blockHandles, dimensionChildHandles);
                failures.AddRange(verification.Failures);
                var afterHash = HashFile(inputPath);
                if (afterHash != manifest.SourceSha256) failures.Add("input manifest bytes changed during the run");
                if (!NotificationsMatchExpected(writerDiagnostics, readerDiagnostics)) failures.Add("engine notifications did not match the pinned zero-writer/four-reader allowlist");

                var report = new
                {
                    qualification = "experimental-unqualified",
                    status = failures.Count == 0 ? "passed-internal-semantic-comparison" : "failed",
                    productionDwgDeliveryQualification = "not-qualified",
                    independentCadVerification = "not-performed",
                    canonicalSourceValidation = "producer-required",
                    engine = EngineEvidence(),
                    tolerances = new { geometryAbsoluteMillimeters = NativeDwgVerification.GeometryTolerance, angularRadians = NativeDwgVerification.AngularTolerance },
                    input = new
                    {
                        fileName = manifest.SourceFileName,
                        sha256 = manifest.SourceSha256,
                        bytes = manifest.SourceBytes.Length,
                        scope = manifest.Scope,
                        originalBytesPreserved = afterHash == manifest.SourceSha256,
                    },
                    outputs = new
                    {
                        dwg = new { fileName = "native.dwg", sha256 = HashFile(dwgPath) },
                        sourceManifest = new { fileName = "source-manifest.json", sha256 = HashFile(sourcePath) },
                        report = "native-report.json",
                    },
                    outputProfile = manifest.Canvas.OutputProfile,
                    verification,
                    diagnostics = new { writer = writerDiagnostics.Select(PublicDiagnostic).ToArray(), reader = readerDiagnostics.Select(PublicDiagnostic).ToArray() },
                    failures,
                    warnings = Warnings(),
                };
                WriteJsonExclusive(reportPath, report);
                output.WriteLine(reportPath);
                output.WriteLine($"qualification=experimental-unqualified semantic-failures={failures.Count} production=not-qualified");
                return failures.Count == 0 ? 0 : 1;
            }
            catch (Exception exception)
            {
                error.WriteLine($"native write failed: {exception.GetType().Name}: {exception.Message}");
                TryWriteFailureReport(reportPath, manifest, writerDiagnostics, readerDiagnostics, failures, exception);
                return 1;
            }
        }
    }

    internal static NativeDwgBuild BuildDocument(NativeCadManifest manifest)
    {
        var document = new CadDocument(ACadVersion.AC1024);
        document.Header.InsUnits = UnitsType.Millimeters;
        var layerById = new Dictionary<string, Layer>(StringComparer.Ordinal);
        foreach (var source in manifest.Layers)
        {
            var layer = new Layer(source.CadName)
            {
                IsOn = source.Visible,
                Flags = source.Locked ? LayerFlags.Locked : LayerFlags.None,
            };
            document.Layers.Add(layer);
            layerById.Add(source.Id, layer);
        }
        var textStyle = new TextStyle("NATIVE_NOTO_SANS_KR") { Filename = "NotoSansKR-Regular.ttf" };
        document.TextStyles.Add(textStyle);
        var entities = new Dictionary<string, Entity>(StringComparer.Ordinal);
        var blocks = new Dictionary<string, BlockRecord>(StringComparer.Ordinal);
        var dimensionChildren = new Dictionary<string, IReadOnlyList<Entity>>(StringComparer.Ordinal);
        var blockById = new Dictionary<string, BlockRecord>(StringComparer.Ordinal);
        var dimensionIndex = 0;

        foreach (var source in manifest.Blocks)
        {
            var block = new BlockRecord(source.CadName) { Units = UnitsType.Millimeters };
            block.BlockEntity.BasePoint = XYZ.Zero;
            document.BlockRecords.Add(block);
            blockById.Add(source.Id, block);
            blocks.Add(source.Id, block);
        }
        foreach (var source in manifest.Blocks)
        {
            var block = blockById[source.Id];
            foreach (var item in source.Entities)
            {
                var entity = CreateEntity(item, document, null, blockById, textStyle, ref dimensionIndex);
                block.Entities.Add(entity);
                entities.Add(item.Id, entity);
                if (entity is DimensionAligned dimension)
                {
                    dimension.UpdateBlock();
                    PatchDimensionGraphics(dimension, (NativeDimension)item.Geometry, textStyle, document.Layers.Single(item => item.Name == "0"));
                    dimensionChildren[item.Id] = dimension.Block.Entities.ToArray();
                }
            }
        }
        foreach (var item in manifest.Entities)
        {
            var entity = CreateEntity(item, document, layerById[item.LayerId!], blockById, textStyle, ref dimensionIndex);
            document.Entities.Add(entity);
            entities.Add(item.Id, entity);
            if (entity is DimensionAligned dimension)
            {
                dimension.UpdateBlock();
                PatchDimensionGraphics(dimension, (NativeDimension)item.Geometry, textStyle, document.Layers.Single(item => item.Name == "0"));
                dimensionChildren[item.Id] = dimension.Block.Entities.ToArray();
            }
        }
        ConfigureLayout(document, manifest.Canvas);
        return new NativeDwgBuild(document, entities, blocks, dimensionChildren);
    }

    private static Entity CreateEntity(
        NativeEntity source,
        CadDocument document,
        Layer? layer,
        IReadOnlyDictionary<string, BlockRecord> blocks,
        TextStyle textStyle,
        ref int dimensionIndex)
    {
        Entity entity = source.Geometry switch
        {
            NativeLine line => new Line(Point(line.Start), Point(line.End)),
            NativePolyline polyline => new LwPolyline(polyline.Points.Select(point => new XY(point.X, point.Y))) { IsClosed = polyline.Closed },
            NativeCircle circle => new Circle(Point(circle.Center), circle.Radius),
            NativeArc arc => CreateArc(arc),
            NativeText text => CreateText(text, textStyle),
            NativeHatch hatch => CreateHatch(hatch),
            NativeInsert insert => new Insert(blocks[insert.BlockId])
            {
                InsertPoint = Point(insert.Origin),
                XScale = insert.ScaleX,
                YScale = insert.ScaleY,
                ZScale = 1,
                Rotation = Degrees(insert.RotationDegrees),
            },
            NativeDimension dimension => CreateDimension(source, dimension, document, textStyle, ref dimensionIndex),
            _ => throw new InvalidOperationException($"Unsupported native geometry {source.Geometry.Type}."),
        };
        if (layer is not null) entity.Layer = layer;
        if (!source.Style.IsBlockDefined)
        {
            entity.Color = ColorFromHex(source.Style.Stroke!);
            entity.LineWeight = QuantizeLineweight(source.Style.RequestedPaperLineweight);
        }
        if (source.Geometry is NativeHatch hatchGeometry)
        {
            entity.Color = ColorFromHex(hatchGeometry.Color);
            entity.Transparency = Opacity(hatchGeometry.Opacity);
        }
        return entity;
    }

    private static MText CreateText(NativeText source, TextStyle style)
    {
        var radians = Degrees(source.RotationDegrees);
        return new MText(EscapeMText(source.Text))
        {
            InsertPoint = Point(source.Origin),
            Height = source.FontSize,
            RectangleWidth = source.Width,
            AttachmentPoint = AttachmentPointType.TopLeft,
            AlignmentPoint = new XYZ(Math.Cos(radians), Math.Sin(radians), 0),
            LineSpacing = source.LineHeight * 3 / 5,
            LineSpacingStyle = LineSpacingStyleType.Exact,
            Style = style,
        };
    }

    private static DimensionAligned CreateDimension(NativeEntity entity, NativeDimension source, CadDocument document, TextStyle textStyle, ref int index)
    {
        var color = ColorFromHex(entity.Style.Stroke!);
        var lineweight = QuantizeLineweight(entity.Style.RequestedPaperLineweight);
        var style = new DimensionStyle($"NATIVE_DIM_{index++:D5}")
        {
            Style = textStyle,
            TextHeight = source.FontSize,
            DecimalPlaces = checked((short)source.Precision),
            ZeroHandling = (ZeroHandling)0,
            PostFix = $"<>{source.Suffix}",
            ArrowSize = source.FontSize,
            ScaleFactor = 1,
            TextColor = color,
            DimensionLineColor = color,
            ExtensionLineColor = color,
            DimensionLineWeight = lineweight,
            ExtensionLineWeight = lineweight,
            ExtensionLineOffset = 0.625,
            ExtensionLineExtension = 1.25,
        };
        document.DimensionStyles.Add(style);
        return new DimensionAligned(Point(source.Start), Point(source.End))
        {
            DefinitionPoint = Point(source.DimensionLinePoint),
            TextMiddlePoint = Point(source.TextPosition),
            IsTextUserDefinedLocation = true,
            TextRotation = 0,
            Style = style,
        };
    }

    private static Arc CreateArc(NativeArc source)
    {
        var start = Degrees(source.StartAngleDegrees);
        var sweep = (source.EndAngleDegrees - source.StartAngleDegrees) * Math.PI / 180;
        return new Arc(Point(source.Center), source.Radius, start, start + sweep);
    }

    private static Hatch CreateHatch(NativeHatch source)
    {
        Hatch.BoundaryPath path;
        if (source.Polygon is not null)
        {
            var edge = new Hatch.BoundaryPath.Polyline(source.Polygon.Select(Point), true);
            path = new Hatch.BoundaryPath(new Hatch.BoundaryPath.Edge[] { edge });
        }
        else
        {
            var center = source.CircleCenter!.Value;
            var edge = new Hatch.BoundaryPath.Arc
            {
                Center = new XY(center.X, center.Y),
                Radius = source.CircleRadius!.Value,
                StartAngle = 0,
                EndAngle = MathHelper.TwoPI,
                CounterClockWise = true,
            };
            path = new Hatch.BoundaryPath(new Hatch.BoundaryPath.Edge[] { edge });
        }
        path.Flags = BoundaryPathFlags.External;
        return new Hatch
        {
            IsSolid = true,
            IsAssociative = false,
            Pattern = HatchPattern.Solid,
            PatternType = HatchPatternType.SolidFill,
            Style = HatchStyleType.Normal,
            Color = ColorFromHex(source.Color),
            Transparency = Opacity(source.Opacity),
            Paths = [path],
            Normal = XYZ.AxisZ,
            Elevation = 0,
        };
    }

    private static void PatchDimensionGraphics(DimensionAligned dimension, NativeDimension source, TextStyle textStyle, Layer layerZero)
    {
        var points = dimension.Block.Entities.OfType<ACadSharp.Entities.Point>().ToArray();
        var lines = dimension.Block.Entities.OfType<Line>().ToArray();
        var arrows = dimension.Block.Entities.OfType<Solid>().ToArray();
        var texts = dimension.Block.Entities.OfType<MText>().ToArray();
        if (points.Length != 4 || lines.Length != 3 || arrows.Length != 2 || texts.Length != 1 || dimension.Block.Entities.Count() != 10)
            throw new InvalidOperationException("Pinned dimension child shape changed; refusing unverified DIMENSION graphics.");

        var start = Point(source.Start);
        var end = Point(source.End);
        var displayEnd = Point(source.DimensionLinePoint);
        var displayStart = new XYZ(start.X + displayEnd.X - end.X, start.Y + displayEnd.Y - end.Y, 0);
        points[0].Location = start;
        points[1].Location = end;
        points[2].Location = displayStart;
        points[3].Location = displayEnd;
        lines[0].StartPoint = displayStart;
        lines[0].EndPoint = displayEnd;

        var offsetX = displayStart.X - start.X;
        var offsetY = displayStart.Y - start.Y;
        var offsetLength = Math.Sqrt(offsetX * offsetX + offsetY * offsetY);
        var nx = offsetLength == 0 ? 0 : offsetX / offsetLength;
        var ny = offsetLength == 0 ? 1 : offsetY / offsetLength;
        SetLine(lines[1], new XYZ(start.X + nx * 0.625, start.Y + ny * 0.625, 0), new XYZ(displayStart.X + nx * 1.25, displayStart.Y + ny * 1.25, 0));
        SetLine(lines[2], new XYZ(end.X + nx * 0.625, end.Y + ny * 0.625, 0), new XYZ(displayEnd.X + nx * 1.25, displayEnd.Y + ny * 1.25, 0));

        var length = source.Measurement;
        var ux = (end.X - start.X) / length;
        var uy = (end.Y - start.Y) / length;
        var px = -uy;
        var py = ux;
        SetArrow(arrows[0], displayStart, ux, uy, px, py, source.FontSize);
        SetArrow(arrows[1], displayEnd, -ux, -uy, px, py, source.FontSize);

        var text = texts[0];
        text.Value = source.Measurement.ToString("F1", CultureInfo.InvariantCulture) + source.Suffix;
        text.Style = textStyle;
        text.Height = source.FontSize;
        text.Color = Color.ByBlock;
        text.AttachmentPoint = AttachmentPointType.TopLeft;
        text.InsertPoint = Point(source.TextPosition);
        text.AlignmentPoint = XYZ.AxisX;
        foreach (var child in dimension.Block.Entities)
        {
            child.Layer = layerZero;
            child.Color = Color.ByBlock;
            child.LineWeight = LineWeightType.ByBlock;
        }
    }

    private static void SetLine(Line line, XYZ start, XYZ end)
    {
        line.StartPoint = start;
        line.EndPoint = end;
    }

    private static void SetArrow(Solid arrow, XYZ tip, double ux, double uy, double px, double py, double size)
    {
        var half = size / 6;
        arrow.FirstCorner = tip;
        arrow.SecondCorner = new XYZ(tip.X + ux * size + px * half, tip.Y + uy * size + py * half, 0);
        arrow.ThirdCorner = new XYZ(tip.X + ux * size - px * half, tip.Y + uy * size - py * half, 0);
        arrow.FourthCorner = arrow.ThirdCorner;
    }

    private static void ConfigureLayout(CadDocument document, NativeCanvas canvas)
    {
        var layout = document.Layouts.First(item => item.IsPaperSpace);
        layout.Name = SafeLayoutName(canvas.OutputProfile.Paper);
        layout.PaperWidth = canvas.OutputProfile.Width;
        layout.PaperHeight = canvas.OutputProfile.Height;
        layout.PaperUnits = PlotPaperUnits.Millimeters;
        layout.PaperSize = $"{canvas.OutputProfile.Paper}_({canvas.OutputProfile.Width:F2}_x_{canvas.OutputProfile.Height:F2}_MM)";
        layout.UpdatePaperViewport();
        layout.AddViewport(new Viewport
        {
            Center = Point(canvas.Viewport.PaperCenter),
            Width = canvas.OutputProfile.Width,
            Height = canvas.OutputProfile.Height,
            ViewHeight = canvas.Viewport.ViewHeight,
            ViewCenter = new XY(canvas.Viewport.ViewCenter.X, canvas.Viewport.ViewCenter.Y),
            ViewDirection = XYZ.AxisZ,
            Status = ViewportStatusFlags.ViewportZoomLocking,
        });
    }

    internal static LineWeightType QuantizeLineweight(double requestedMillimeters)
    {
        var stored = SupportedLineweights.MinBy(value => (Math.Abs(value / 100d - requestedMillimeters), value));
        return (LineWeightType)stored;
    }

    internal static Transparency Opacity(double opacity)
    {
        var alpha = checked((byte)Math.Round(opacity * 255, MidpointRounding.AwayFromZero));
        if (alpha == 0) throw new InvalidDataException("HATCH opacity is not explicitly representable.");
        return alpha == 255 ? Transparency.Opaque : Transparency.FromAlphaValue(alpha);
    }

    internal static Color ColorFromHex(string value) => new(
        Convert.ToByte(value.Substring(1, 2), 16),
        Convert.ToByte(value.Substring(3, 2), 16),
        Convert.ToByte(value.Substring(5, 2), 16));

    internal static string EscapeMText(string value) => value
        .Replace("\\", "\\\\", StringComparison.Ordinal)
        .Replace("{", "\\{", StringComparison.Ordinal)
        .Replace("}", "\\}", StringComparison.Ordinal)
        .Replace("\r\n", "\n", StringComparison.Ordinal)
        .Replace("\r", "\n", StringComparison.Ordinal)
        .Replace("\n", "\\P", StringComparison.Ordinal);

    private static string SafeLayoutName(string paper)
    {
        var result = new string(paper.Select(character => char.IsLetterOrDigit(character) || character is '-' or '_' ? character : '_').ToArray());
        return string.IsNullOrWhiteSpace(result) ? "NATIVE_PAPER" : $"NATIVE_{result}";
    }

    private static object EngineEvidence()
    {
        var assembly = typeof(CadDocument).Assembly;
        return new { package = "ACadSharp", pinnedVersion = "3.7.1", assemblyVersion = assembly.GetName().Version?.ToString() ?? "unknown", framework = ".NET 8.0" };
    }

    private static IReadOnlyList<string> Warnings() =>
    [
        "Canonical source validation and authority remain producer-required.",
        "NotoSansKR-Regular.ttf is named but is not read, embedded, redistributed, or visually qualified.",
        "MTEXT automatic font-dependent wrapping and recipient rendering are not qualified.",
        "Independent CAD open/save/print verification was not performed.",
        "This output does not qualify production DWG delivery or existing-DWG preservation.",
    ];

    internal static bool NotificationsMatchExpected(IReadOnlyList<string> writerDiagnostics, IReadOnlyList<string> readerDiagnostics) =>
        writerDiagnostics.Count == 0 && readerDiagnostics.Count == 4 && readerDiagnostics.All(message => message == ExpectedTableStyleNotification);

    private static string PublicDiagnostic(string message) => message == ExpectedTableStyleNotification ? message : "unexpected engine notification omitted";

    internal static void TryWriteFailureReport(string reportPath, NativeCadManifest manifest, IReadOnlyList<string> writerDiagnostics, IReadOnlyList<string> readerDiagnostics, IReadOnlyList<string> failures, Exception exception)
    {
        try
        {
            if (File.Exists(reportPath) || Directory.Exists(reportPath) || new FileInfo(reportPath).LinkTarget is not null) return;
            WriteJsonExclusive(reportPath, new
            {
                qualification = "experimental-unqualified",
                status = "failed",
                productionDwgDeliveryQualification = "not-qualified",
                independentCadVerification = "not-performed",
                canonicalSourceValidation = "producer-required",
                input = new { fileName = manifest.SourceFileName, sha256 = manifest.SourceSha256, scope = manifest.Scope },
                error = new { code = PublicFailureCode(exception), type = exception.GetType().Name, message = PublicFailureMessage(exception) },
                diagnostics = new { writer = writerDiagnostics.Select(PublicDiagnostic).ToArray(), reader = readerDiagnostics.Select(PublicDiagnostic).ToArray() },
                failures,
                warnings = Warnings(),
            });
        }
        catch (Exception reportException)
        {
            _ = reportException;
        }
    }

    private static void WriteExclusive(string path, byte[] bytes)
    {
        using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        stream.Write(bytes);
    }

    private static void WriteJsonExclusive<T>(string path, T value)
    {
        using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        JsonSerializer.Serialize(stream, value, JsonOptions);
    }

    private static string HashFile(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    internal static string Handle(ulong handle) => handle.ToString("X", CultureInfo.InvariantCulture);
    internal static XYZ Point(CadPoint point) => new(point.X, point.Y, 0);
    internal static double Degrees(double degrees) => (degrees % 360) * Math.PI / 180;
    private static string PublicFailureCode(Exception exception) => exception switch
    {
        IOException or UnauthorizedAccessException => "engine-io-failed",
        _ => "engine-operation-failed",
    };
    private static string PublicFailureMessage(Exception exception) => exception switch
    {
        IOException or UnauthorizedAccessException => "The native CAD operation could not access a required bounded artifact.",
        _ => "The native CAD operation failed; inspect bounded diagnostics and retry.",
    };
}
