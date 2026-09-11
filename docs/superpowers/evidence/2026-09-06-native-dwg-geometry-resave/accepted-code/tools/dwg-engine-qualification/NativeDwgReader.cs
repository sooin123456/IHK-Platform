using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ACadSharp;
using ACadSharp.Blocks;
using ACadSharp.Entities;
using ACadSharp.IO;
using ACadSharp.Tables;
using CSMath;

namespace DwgEngineQualification;

internal static class NativeDwgReader
{
    private const long MaximumSourceBytes = 200L * 1024 * 1024;
    private const int MaximumEntities = 10_000;
    private const int MaximumLayers = 1_000;
    private const int MaximumVertices = 100_000;
    private const int MaximumUnsupportedGroups = 100;
    private const int MaximumUnsupportedSamples = 10;
    private const int MaximumReportBytes = 32 * 1024 * 1024;
    private const double MaximumCoordinate = 999_999_999_999d;
    private const int MaximumTextLength = 10_000;
    private const string ReportName = "native-import.json";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static int Run(
        string inputPath,
        string outputDirectory,
        TextWriter output,
        TextWriter error)
    {
        try
        {
            var paths = QualificationPaths.Create(inputPath, outputDirectory);
            RejectExistingOutput(paths.OutputDirectory);
            var sourceBytes = ReadBoundedSource(paths.InputPath);
            var reportBytes = BuildReportBytes(sourceBytes, out var source);
            var after = SourceIdentity.Create(ReadBoundedSource(paths.InputPath));
            if (source != after)
                throw new InvalidDataException("Source bytes changed while reading.");

            PublishReport(paths.OutputDirectory, reportBytes);

            output.WriteLine("native-import.json");
            return 0;
        }
        catch (Exception exception)
        {
            error.WriteLine(exception is ArgumentException or FileNotFoundException or InvalidDataException
                ? "native read rejected: invalid input or output"
                : "native read failed: engine or filesystem operation failed");
            return exception is ArgumentException or FileNotFoundException or InvalidDataException ? 2 : 1;
        }
    }

    public static int RunStream(Stream input, Stream output, TextWriter error)
    {
        try
        {
            var reportBytes = BuildReportBytes(ReadBoundedSource(input), out _);
            output.Write(reportBytes);
            return 0;
        }
        catch (Exception exception)
        {
            error.WriteLine("native stream read failed.");
            return exception is ArgumentException or InvalidDataException ? 2 : 1;
        }
    }

    private static byte[] BuildReportBytes(byte[] sourceBytes, out SourceIdentity source)
    {
        source = SourceIdentity.Create(sourceBytes);
        var notifications = 0;
        CadDocument document;
        using (var stream = new MemoryStream(sourceBytes, writable: false))
        using (var reader = new DwgReader(stream))
        {
            reader.Configuration.Failsafe = false;
            reader.Configuration.KeepUnknownEntities = true;
            reader.Configuration.KeepUnknownNonGraphicalObjects = true;
            reader.OnNotification += (_, _) => notifications++;
            document = reader.Read();
        }

        var reportBytes = JsonSerializer.SerializeToUtf8Bytes(BuildReport(document, source, notifications), JsonOptions);
        if (reportBytes.Length > MaximumReportBytes)
            throw new InvalidDataException("DWG import report budget exceeded.");
        return reportBytes;
    }

    private static object BuildReport(CadDocument document, SourceIdentity source, int notificationCount)
    {
        if (document.Header.VersionString != source.HeaderVersion)
            throw new InvalidDataException("DWG header version is inconsistent.");
        if (document.Layers.Count() > MaximumLayers)
            throw new InvalidDataException("DWG layer budget exceeded.");

        var modelSpace = document.ModelSpace
            ?? throw new InvalidDataException("DWG model space is missing.");
        var modelSpaceHandle = CanonicalHandle(modelSpace.Handle);
        var layers = document.Layers.OrderBy(layer => layer.Handle).ToArray();
        var layerHandles = new HashSet<ulong>();
        var identityHandles = new HashSet<ulong>();
        var layerRecords = new List<object>(layers.Length);
        foreach (var layer in layers)
        {
            ValidateIdentity(layer.Handle, layerHandles, "layer");
            if (!identityHandles.Add(layer.Handle))
                throw new InvalidDataException("DWG object identities are duplicated.");
            ValidateBoundedText(layer.Name, 255, allowEmpty: false);
            layerRecords.Add(new
            {
                handle = CanonicalHandle(layer.Handle),
                name = layer.Name,
                visible = layer.IsOn,
                locked = layer.Flags.HasFlag(LayerFlags.Locked),
            });
        }

        var blockHandles = new HashSet<ulong>();
        foreach (var block in document.BlockRecords)
        {
            ValidateIdentity(block.Handle, blockHandles, "block");
            if (!identityHandles.Add(block.Handle))
                throw new InvalidDataException("DWG object identities are duplicated.");
        }
        if (!blockHandles.Contains(modelSpace.Handle))
            throw new InvalidDataException("DWG model-space identity is invalid.");

        var entityOwners = document.BlockRecords
            .SelectMany(block => block.Entities.Select(entity => (Block: block, Entity: entity)))
            .ToArray();
        if (entityOwners.Length > MaximumEntities)
            throw new InvalidDataException("DWG entity budget exceeded.");

        var entityHandles = new HashSet<ulong>();
        var vertexCount = 0;
        foreach (var pair in entityOwners)
        {
            ValidateIdentity(pair.Entity.Handle, entityHandles, "entity");
            if (!identityHandles.Add(pair.Entity.Handle))
                throw new InvalidDataException("DWG object identities are duplicated.");
            if (pair.Entity.Owner?.Handle != pair.Block.Handle)
                throw new InvalidDataException("DWG entity owner is inconsistent.");
            if (pair.Entity.Layer is null || !layerHandles.Contains(pair.Entity.Layer.Handle))
                throw new InvalidDataException("DWG entity layer reference is invalid.");
            if (pair.Entity is IPolyline polyline)
            {
                vertexCount = checked(vertexCount + polyline.Vertices.Count());
                if (vertexCount > MaximumVertices)
                    throw new InvalidDataException("DWG vertex budget exceeded.");
            }
        }

        RejectExternalReferences(document);
        var modelEntities = document.Entities.ToArray();
        if (modelEntities.Any(entity => entity.Owner?.Handle != modelSpace.Handle))
            throw new InvalidDataException("DWG model-space ownership is inconsistent.");

        var imported = new List<object>();
        var unsupported = new Dictionary<(string Type, string Reason), UnsupportedAccumulator>();
        foreach (var entity in modelEntities.OrderBy(entity => entity.Handle))
        {
            var type = SafeType(entity.ObjectName);
            var handle = CanonicalHandle(entity.Handle);
            if (TryGeometry(entity, out var supportedType, out var geometry, out var reason))
            {
                imported.Add(new
                {
                    handle,
                    ownerHandle = modelSpaceHandle,
                    layerHandle = CanonicalHandle(entity.Layer!.Handle),
                    type = supportedType,
                    geometry,
                });
            }
            else
            {
                var key = (type, reason);
                if (!unsupported.TryGetValue(key, out var accumulator))
                {
                    if (unsupported.Count == MaximumUnsupportedGroups)
                        throw new InvalidDataException("DWG unsupported category budget exceeded.");
                    accumulator = new UnsupportedAccumulator();
                    unsupported.Add(key, accumulator);
                }
                accumulator.Count++;
                if (accumulator.SampleHandles.Count < MaximumUnsupportedSamples)
                    accumulator.SampleHandles.Add(handle);
            }
        }

        var unsupportedRecords = unsupported
            .OrderBy(pair => pair.Key.Type, StringComparer.Ordinal)
            .ThenBy(pair => pair.Key.Reason, StringComparer.Ordinal)
            .Select(pair => new
            {
                type = pair.Key.Type,
                reason = pair.Key.Reason,
                count = pair.Value.Count,
                sampleHandles = pair.Value.SampleHandles.ToArray(),
            })
            .ToArray();
        var unsupportedCount = unsupportedRecords.Sum(record => record.count);
        if (imported.Count + unsupportedCount != modelEntities.Length)
            throw new InvalidDataException("DWG coverage count is inconsistent.");

        return new
        {
            schemaVersion = "1hk-dwg-import/1",
            qualification = "experimental-unqualified",
            source = new
            {
                sha256 = source.Sha256,
                byteSize = source.ByteSize,
                headerVersion = source.HeaderVersion,
            },
            engine = new { name = "ACadSharp", version = "3.7.1" },
            coordinateSystem = "WCS_NATIVE_UNITS",
            unitCode = (int)document.Header.InsUnits,
            modelSpaceHandle,
            layers = layerRecords,
            entities = imported,
            coverage = new
            {
                modelSpaceEntities = modelEntities.Length,
                importedEntities = imported.Count,
                unsupportedEntities = unsupportedCount,
                nonModelSpaceEntities = entityOwners.Length - modelEntities.Length,
            },
            unsupported = unsupportedRecords,
            readerNotificationCount = notificationCount,
        };
    }

    internal static bool TryGeometry(Entity entity, out string type, out object? geometry, out string reason)
    {
        type = SafeType(entity.ObjectName);
        geometry = null;
        reason = "unsupported_type";
        switch (entity)
        {
            case Line line when line.GetType() == typeof(Line):
                type = "LINE";
                if (!Planar(line.StartPoint.Z, line.EndPoint.Z, line.Normal, line.Thickness)
                    || !PointValid(line.StartPoint) || !PointValid(line.EndPoint)
                    || SamePoint(line.StartPoint, line.EndPoint))
                {
                    reason = "unsupported_geometry";
                    return false;
                }
                geometry = new { start = Point(line.StartPoint), end = Point(line.EndPoint) };
                return true;

            case Arc arc when arc.GetType() == typeof(Arc):
                type = "ARC";
                if (!Planar(arc.Center.Z, arc.Normal, arc.Thickness)
                    || !PointValid(arc.Center) || !PositiveValid(arc.Radius)
                    || !NumberValid(arc.StartAngle) || !NumberValid(arc.EndAngle)
                    || InvalidArc(arc.StartAngle, arc.EndAngle))
                {
                    reason = "unsupported_geometry";
                    return false;
                }
                geometry = new
                {
                    center = Point(arc.Center),
                    radius = arc.Radius,
                    startAngleRadians = arc.StartAngle,
                    endAngleRadians = arc.EndAngle,
                };
                return true;

            case Circle circle when circle.GetType() == typeof(Circle):
                type = "CIRCLE";
                if (!Planar(circle.Center.Z, circle.Normal, circle.Thickness)
                    || !PointValid(circle.Center) || !PositiveValid(circle.Radius))
                {
                    reason = "unsupported_geometry";
                    return false;
                }
                geometry = new { center = Point(circle.Center), radius = circle.Radius };
                return true;

            case LwPolyline polyline when polyline.GetType() == typeof(LwPolyline):
                type = "LWPOLYLINE";
                var points = polyline.Vertices.Select(vertex => new XYZ(vertex.Location.X, vertex.Location.Y, polyline.Elevation)).ToArray();
                var expectedClosedFlag = polyline.IsClosed ? 1 : 0;
                var flags = Convert.ToInt32(polyline.Flags, CultureInfo.InvariantCulture);
                if (!Planar(polyline.Elevation, polyline.Normal, polyline.Thickness)
                    || polyline.Vertices.Count < 2
                    || (flags & 1) != expectedClosedFlag
                    || (flags & ~(1 | (int)LwPolylineFlags.Plinegen)) != 0
                    || polyline.ConstantWidth != 0
                    || polyline.Vertices.Any(vertex => vertex.Bulge != 0 || vertex.StartWidth != 0 || vertex.EndWidth != 0)
                    || points.Any(point => !PointValid(point))
                    || points.Skip(1).All(point => SamePoint(points[0], point)))
                {
                    reason = "unsupported_geometry";
                    return false;
                }
                geometry = new { points = points.Select(Point).ToArray(), closed = polyline.IsClosed };
                return true;

            case TextEntity text when text.GetType() == typeof(TextEntity):
                type = "TEXT";
                if (!Planar(text.InsertPoint.Z, text.Normal, text.Thickness)
                    || !PointValid(text.InsertPoint) || !PositiveValid(text.Height))
                {
                    reason = "unsupported_geometry";
                    return false;
                }
                if (text.Rotation != 0 || text.ObliqueAngle != 0 || text.WidthFactor != 1
                    || Convert.ToInt32(text.HorizontalAlignment, CultureInfo.InvariantCulture) != 0
                    || Convert.ToInt32(text.VerticalAlignment, CultureInfo.InvariantCulture) != 0
                    || Convert.ToInt32(text.Mirror, CultureInfo.InvariantCulture) != 0
                    || !PlainTextValid(text.Value))
                {
                    reason = "unsupported_text";
                    return false;
                }
                geometry = new { insert = Point(text.InsertPoint), height = text.Height, text = text.Value };
                return true;

            default:
                return false;
        }
    }

    private static void RejectExternalReferences(CadDocument document)
    {
        if (document.BlockRecords.Any(block =>
                !string.IsNullOrWhiteSpace(block.BlockEntity.XRefPath)
                || block.BlockEntity.Flags.HasFlag(BlockTypeFlags.XRef)))
            throw new InvalidDataException("External references are unsupported.");
    }

    private static byte[] ReadBoundedSource(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length <= 0 || stream.Length > MaximumSourceBytes)
            throw new InvalidDataException("DWG source size is unsupported.");
        var bytes = new byte[stream.Length];
        stream.ReadExactly(bytes);
        if (stream.ReadByte() != -1)
            throw new InvalidDataException("DWG source grew while reading.");
        ValidateHeader(bytes);
        return bytes;
    }

    private static byte[] ReadBoundedSource(Stream input)
    {
        using var bytes = new MemoryStream();
        var buffer = new byte[81_920];
        while (true)
        {
            var read = input.Read(buffer, 0, buffer.Length);
            if (read == 0) break;
            if (bytes.Length + read > MaximumSourceBytes)
                throw new InvalidDataException("DWG source size is unsupported.");
            bytes.Write(buffer, 0, read);
        }
        var source = bytes.ToArray();
        if (source.Length == 0)
            throw new InvalidDataException("DWG source size is unsupported.");
        ValidateHeader(source);
        return source;
    }

    private static void ValidateHeader(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length < 6 || bytes[0] != (byte)'A' || bytes[1] != (byte)'C'
            || bytes[2..6].IndexOfAnyExceptInRange((byte)'0', (byte)'9') >= 0)
            throw new InvalidDataException("DWG source header is invalid.");
    }

    private static void RejectExistingOutput(string outputDirectory)
    {
        var probe = new FileInfo(outputDirectory);
        if (File.Exists(outputDirectory) || Directory.Exists(outputDirectory) || probe.LinkTarget is not null)
            throw new ArgumentException("Output directory must be a fresh path.");
    }

    private static void PublishReport(string outputDirectory, byte[] reportBytes)
    {
        var parent = Path.GetDirectoryName(outputDirectory)
            ?? throw new ArgumentException("Output directory has no parent.");
        Directory.CreateDirectory(parent);
        var name = Path.GetFileName(outputDirectory);
        var stagingDirectory = Path.Combine(parent, $".{name}.{Guid.NewGuid():N}.native-import-stage");
        Directory.CreateDirectory(stagingDirectory);
        try
        {
            var reportPath = QualificationPaths.BoundedOutputPath(stagingDirectory, ReportName);
            using (var reportStream = new FileStream(reportPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                reportStream.Write(reportBytes);
            Directory.Move(stagingDirectory, outputDirectory);
            stagingDirectory = string.Empty;
        }
        finally
        {
            if (stagingDirectory.Length > 0)
                CleanupStagingOutput(stagingDirectory);
        }
    }

    private static void CleanupStagingOutput(string stagingDirectory)
    {
        try
        {
            if (Directory.Exists(stagingDirectory) && new DirectoryInfo(stagingDirectory).LinkTarget is null)
                Directory.Delete(stagingDirectory, recursive: true);
        }
        catch
        {
            // A bounded public error is preferable to leaking a cleanup path or exception.
        }
    }

    private static void ValidateIdentity(ulong handle, ISet<ulong> handles, string label)
    {
        if (handle == 0) throw new InvalidDataException($"DWG {label} identity is zero.");
        if (!handles.Add(handle)) throw new InvalidDataException($"DWG {label} identity is duplicated.");
    }

    private static string CanonicalHandle(ulong handle)
    {
        if (handle == 0) throw new InvalidDataException("DWG identity is zero.");
        return handle.ToString("X", CultureInfo.InvariantCulture);
    }

    private static string SafeType(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "UNKNOWN";
        var builder = new StringBuilder(Math.Min(64, value.Length));
        foreach (var character in value)
        {
            if (builder.Length == 64) break;
            builder.Append(character is >= 'A' and <= 'Z' or >= '0' and <= '9' or '_' ? character : '_');
        }
        return builder.Length == 0 ? "UNKNOWN" : builder.ToString();
    }

    private static bool Planar(double z, XYZ normal, double thickness) =>
        z == 0 && thickness == 0 && normal.X == 0 && normal.Y == 0 && normal.Z == 1;

    private static bool Planar(double firstZ, double secondZ, XYZ normal, double thickness) =>
        firstZ == 0 && secondZ == 0 && Planar(0, normal, thickness);

    private static bool PointValid(XYZ point) =>
        NumberValid(point.X) && NumberValid(point.Y) && NumberValid(point.Z);

    private static bool NumberValid(double value) =>
        double.IsFinite(value) && Math.Abs(value) <= MaximumCoordinate;

    private static bool PositiveValid(double value) => NumberValid(value) && value > 0;

    private static bool SamePoint(XYZ first, XYZ second) =>
        first.X == second.X && first.Y == second.Y && first.Z == second.Z;

    private static bool InvalidArc(double start, double end) =>
        start == end || Math.Abs(end - start) > Math.PI * 2;

    private static double[] Point(XYZ point) => [point.X, point.Y, point.Z];

    private static bool PlainTextValid(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > MaximumTextLength
            || value.Contains("%%", StringComparison.Ordinal)
            || value.Contains("%<", StringComparison.Ordinal))
            return false;
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            if (char.IsControl(character) || char.GetUnicodeCategory(character) is
                UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator)
                return false;
            if (char.IsHighSurrogate(character))
            {
                if (++index >= value.Length || !char.IsLowSurrogate(value[index])) return false;
            }
            else if (char.IsLowSurrogate(character)) return false;
        }
        return true;
    }

    private static void ValidateBoundedText(string? value, int maximumLength, bool allowEmpty)
    {
        if (value is null || value.Length > maximumLength || (!allowEmpty && value.Length == 0))
            throw new InvalidDataException("DWG text identity is invalid.");
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            if (char.IsControl(character) || char.GetUnicodeCategory(character) is
                UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator)
                throw new InvalidDataException("DWG text identity is invalid.");
            if (char.IsHighSurrogate(character))
            {
                if (++index >= value.Length || !char.IsLowSurrogate(value[index]))
                    throw new InvalidDataException("DWG text identity is invalid.");
            }
            else if (char.IsLowSurrogate(character))
                throw new InvalidDataException("DWG text identity is invalid.");
        }
    }

    private sealed class UnsupportedAccumulator
    {
        public int Count { get; set; }
        public List<string> SampleHandles { get; } = [];
    }

    private sealed record SourceIdentity(string Sha256, long ByteSize, string HeaderVersion)
    {
        public static SourceIdentity Create(byte[] bytes) => new(
            Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            bytes.LongLength,
            Encoding.ASCII.GetString(bytes, 0, 6));
    }
}
