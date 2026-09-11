using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ACadSharp;
using ACadSharp.Entities;
using CSMath;

namespace DwgEngineQualification;

internal sealed record SelectedDwgEdit(
    ulong Handle,
    string Type,
    XYZ? Start = null,
    XYZ? End = null,
    IReadOnlyList<XYZ>? Points = null,
    bool? Closed = null,
    XYZ? Center = null,
    double? Radius = null,
    double? StartAngleRadians = null,
    double? EndAngleRadians = null,
    XYZ? Insert = null,
    double? Height = null,
    string? Text = null);

internal sealed record DwgEditRequestEvidence(string Sha256, string SourceSha256, IReadOnlyList<string> Handles);

// The source hash fixes handle identity; coordinates are WCS in the source's native units.
// This is an internal engine request, never proof of app authorization or recipient qualification.
internal sealed class SelectedDwgEdits
{
    private const int MaximumBytes = 2 * 1024 * 1024;
    private const int MaximumPolylinePoints = 100_000;
    private const double MaximumNumber = 999_999_999_999d;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    internal byte[] Bytes { get; }
    internal DwgEditRequestEvidence Evidence { get; }
    private bool IsVersion2 { get; }
    private IReadOnlyList<SelectedDwgEdit> Edits { get; }

    private SelectedDwgEdits(
        byte[] bytes,
        string sourceSha256,
        bool isVersion2,
        IReadOnlyList<SelectedDwgEdit> edits)
    {
        Bytes = bytes;
        IsVersion2 = isVersion2;
        Edits = edits;
        Evidence = new DwgEditRequestEvidence(
            Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), sourceSha256,
            edits.Select(edit => edit.Handle.ToString("X", CultureInfo.InvariantCulture)).ToArray());
    }

    internal static SelectedDwgEdits Load(string path)
    {
        using var stream = File.OpenRead(path);
        if (stream.Length > MaximumBytes) throw new InvalidDataException("DWG edit request exceeds 2 MiB.");
        var bytes = new byte[checked((int)stream.Length)];
        stream.ReadExactly(bytes);
        if (stream.ReadByte() != -1) throw new InvalidDataException("DWG edit request changed while reading.");
        _ = StrictUtf8.GetString(bytes);
        using var json = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 8 });
        var root = ExactObject(json.RootElement, "schemaVersion", "sourceSha256", "coordinateSystem", "edits");
        var version = String(root.GetProperty("schemaVersion"));
        var isVersion2 = version switch
        {
            "1hk-dwg-edits/1" => false,
            "1hk-dwg-edits/2" => true,
            _ => throw new InvalidDataException("DWG edit schema is unsupported."),
        };
        if (String(root.GetProperty("coordinateSystem")) != "WCS_NATIVE_UNITS")
            throw new InvalidDataException("DWG edit coordinate policy is unsupported.");
        var sourceSha = String(root.GetProperty("sourceSha256"));
        if (sourceSha.Length != 64 || sourceSha.Any(c => !(c is >= '0' and <= '9' or >= 'a' and <= 'f')))
            throw new InvalidDataException("DWG edit source SHA-256 is invalid.");
        var items = root.GetProperty("edits");
        if (items.ValueKind != JsonValueKind.Array || items.GetArrayLength() is < 1 or > 10_000)
            throw new InvalidDataException("DWG edit count must be between 1 and 10000.");

        var handles = new HashSet<ulong>();
        var edits = new List<SelectedDwgEdit>();
        var polylinePoints = 0;
        foreach (var item in items.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("type", out var typeValue))
                throw new InvalidDataException("DWG edit type is required.");
            var type = String(typeValue);
            ExactObject(item, Keys(isVersion2, type));
            var handle = Handle(item.GetProperty("handle"), handles);
            edits.Add(isVersion2
                ? ParseVersion2(item, handle, type, ref polylinePoints)
                : ParseVersion1(item, handle, type));
        }
        return new SelectedDwgEdits(bytes, sourceSha, isVersion2, edits);
    }

    internal void Apply(CadDocument document, string actualSourceSha256)
    {
        if (Evidence.SourceSha256 != actualSourceSha256)
            throw new InvalidDataException("DWG edit source SHA-256 does not match the working copy.");
        if (IsVersion2) QualificationRunner.RejectUnwritableObjects(document);

        var groups = document.BlockRecords.SelectMany(block => block.Entities).GroupBy(entity => entity.Handle).ToArray();
        if (groups.Any(group => group.Count() != 1))
            throw new InvalidDataException("DWG has ambiguous entity handles.");
        var modelEntities = document.Entities.ToDictionary(entity => entity.Handle);
        var resultingPolylinePoints = 0;
        if (IsVersion2)
            foreach (var polyline in document.BlockRecords.SelectMany(block => block.Entities).OfType<IPolyline>())
                resultingPolylinePoints = checked(resultingPolylinePoints + polyline.Vertices.Count());

        // Candidate clones prove every v2 result still satisfies the exact reader profile before any source entity changes.
        foreach (var edit in Edits)
        {
            if (!modelEntities.TryGetValue(edit.Handle, out var entity) || entity.GetType() != RuntimeType(edit.Type))
                throw new InvalidDataException("DWG edit target is missing, not model space, or has a different type.");
            if (!IsVersion2) continue;
            if (!NativeDwgReader.TryGeometry(entity, out var sourceType, out _, out _) || sourceType != edit.Type)
                throw new InvalidDataException("DWG v2 edit target or result is not supported reader geometry.");
            var candidate = (Entity)entity.Clone();
            ApplyOne(candidate, edit);
            if (!NativeDwgReader.TryGeometry(candidate, out var type, out _, out _) || type != edit.Type)
                throw new InvalidDataException("DWG v2 edit target or result is not supported reader geometry.");
            if (entity is LwPolyline sourcePolyline)
                resultingPolylinePoints = checked(resultingPolylinePoints - sourcePolyline.Vertices.Count + edit.Points!.Count);
        }
        if (IsVersion2 && resultingPolylinePoints > MaximumPolylinePoints)
            throw new InvalidDataException("DWG v2 resulting document point budget exceeded.");
        foreach (var edit in Edits) ApplyOne(modelEntities[edit.Handle], edit);
    }

    private static SelectedDwgEdit ParseVersion1(JsonElement item, ulong handle, string type)
    {
        if (type == "LINE")
        {
            var start = Point(item.GetProperty("start"), planar: false);
            var end = Point(item.GetProperty("end"), planar: false);
            if (SamePoint(start, end)) throw new InvalidDataException("DWG edited LINE must have nonzero length.");
            return new SelectedDwgEdit(handle, type, Start: start, End: end);
        }
        var text = String(item.GetProperty("text"));
        ValidateText(text, allowEmpty: true);
        return new SelectedDwgEdit(handle, type, Text: text);
    }

    private static SelectedDwgEdit ParseVersion2(
        JsonElement item,
        ulong handle,
        string type,
        ref int polylinePoints)
    {
        switch (type)
        {
            case "LINE":
                var start = Point(item.GetProperty("start"), planar: true);
                var end = Point(item.GetProperty("end"), planar: true);
                if (SamePoint(start, end)) throw new InvalidDataException("DWG edited LINE must have nonzero length.");
                return new SelectedDwgEdit(handle, type, Start: start, End: end);

            case "LWPOLYLINE":
                var pointsValue = item.GetProperty("points");
                if (pointsValue.ValueKind != JsonValueKind.Array || pointsValue.GetArrayLength() < 2)
                    throw new InvalidDataException("DWG edited LWPOLYLINE must have at least two points.");
                polylinePoints = checked(polylinePoints + pointsValue.GetArrayLength());
                if (polylinePoints > MaximumPolylinePoints)
                    throw new InvalidDataException("DWG edited LWPOLYLINE point budget exceeded.");
                var points = pointsValue.EnumerateArray().Select(value => Point(value, planar: true)).ToArray();
                if (points.Skip(1).All(point => SamePoint(points[0], point)))
                    throw new InvalidDataException("DWG edited LWPOLYLINE must have at least two distinct points.");
                var closedValue = item.GetProperty("closed");
                if (closedValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                    throw new InvalidDataException("DWG edited LWPOLYLINE closed flag must be boolean.");
                return new SelectedDwgEdit(handle, type, Points: points, Closed: closedValue.GetBoolean());

            case "CIRCLE":
                return new SelectedDwgEdit(
                    handle,
                    type,
                    Center: Point(item.GetProperty("center"), planar: true),
                    Radius: PositiveNumber(item.GetProperty("radius"), "radius"));

            case "ARC":
                var arcStart = Number(item.GetProperty("startAngleRadians"));
                var arcEnd = Number(item.GetProperty("endAngleRadians"));
                var difference = Math.Abs(arcEnd - arcStart);
                if (difference == 0 || difference > Math.PI * 2)
                    throw new InvalidDataException("DWG edited ARC angle difference must be nonzero and at most 2π.");
                return new SelectedDwgEdit(
                    handle,
                    type,
                    Center: Point(item.GetProperty("center"), planar: true),
                    Radius: PositiveNumber(item.GetProperty("radius"), "radius"),
                    StartAngleRadians: arcStart,
                    EndAngleRadians: arcEnd);

            case "TEXT":
                var text = String(item.GetProperty("text"));
                ValidateText(text, allowEmpty: false);
                return new SelectedDwgEdit(
                    handle,
                    type,
                    Insert: Point(item.GetProperty("insert"), planar: true),
                    Height: PositiveNumber(item.GetProperty("height"), "height"),
                    Text: text);

            default:
                throw new InvalidDataException("DWG v2 edit type is unsupported.");
        }
    }

    private static string[] Keys(bool isVersion2, string type) => (isVersion2, type) switch
    {
        (false, "LINE") => ["handle", "type", "start", "end"],
        (false, "TEXT") => ["handle", "type", "text"],
        (false, _) => throw new InvalidDataException("Only explicit LINE and plain TEXT v1 edits are supported."),
        (true, "LINE") => ["handle", "type", "start", "end"],
        (true, "LWPOLYLINE") => ["handle", "type", "points", "closed"],
        (true, "CIRCLE") => ["handle", "type", "center", "radius"],
        (true, "ARC") => ["handle", "type", "center", "radius", "startAngleRadians", "endAngleRadians"],
        (true, "TEXT") => ["handle", "type", "insert", "height", "text"],
        (true, _) => throw new InvalidDataException("DWG v2 edit type is unsupported."),
    };

    private static Type RuntimeType(string type) => type switch
    {
        "LINE" => typeof(Line),
        "LWPOLYLINE" => typeof(LwPolyline),
        "CIRCLE" => typeof(Circle),
        "ARC" => typeof(Arc),
        "TEXT" => typeof(TextEntity),
        _ => throw new InvalidDataException("DWG edit type is unsupported."),
    };

    private static void ApplyOne(Entity entity, SelectedDwgEdit edit)
    {
        switch (entity)
        {
            case Line line:
                line.StartPoint = edit.Start!.Value;
                line.EndPoint = edit.End!.Value;
                break;
            case LwPolyline polyline:
                // Vertices correspond by index: retain existing IDs/metadata, default new
                // trailing vertices, and remove only the explicitly omitted trailing ones.
                for (var index = 0; index < edit.Points!.Count; index++)
                {
                    var point = edit.Points[index];
                    if (index == polyline.Vertices.Count) polyline.Vertices.Add(new LwPolyline.Vertex());
                    polyline.Vertices[index].Location = new XY(point.X, point.Y);
                }
                while (polyline.Vertices.Count > edit.Points.Count)
                    polyline.Vertices.RemoveAt(polyline.Vertices.Count - 1);
                polyline.IsClosed = edit.Closed!.Value;
                break;
            case Arc arc:
                arc.Center = edit.Center!.Value;
                arc.Radius = edit.Radius!.Value;
                arc.StartAngle = edit.StartAngleRadians!.Value;
                arc.EndAngle = edit.EndAngleRadians!.Value;
                break;
            case Circle circle:
                circle.Center = edit.Center!.Value;
                circle.Radius = edit.Radius!.Value;
                break;
            case TextEntity text:
                if (edit.Insert is not null) text.InsertPoint = edit.Insert.Value;
                if (edit.Height is not null) text.Height = edit.Height.Value;
                text.Value = edit.Text!;
                break;
            default:
                throw new InvalidDataException("DWG edit type is unsupported.");
        }
    }

    private static JsonElement ExactObject(JsonElement value, params string[] keys)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new InvalidDataException("DWG edit JSON object is required.");
        var actual = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!actual.Add(property.Name) || !keys.Contains(property.Name, StringComparer.Ordinal))
                throw new InvalidDataException("DWG edit JSON contains a duplicate or unknown field.");
        if (actual.Count != keys.Length) throw new InvalidDataException("DWG edit JSON is missing a required field.");
        return value;
    }

    private static string String(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.String) throw new InvalidDataException("DWG edit JSON string is required.");
        var result = value.GetString()!;
        _ = StrictUtf8.GetByteCount(result);
        return result;
    }

    private static ulong Handle(JsonElement value, ISet<ulong> handles)
    {
        var text = String(value);
        if (text.Length is < 1 or > 16 || text[0] == '0'
            || text.Any(c => !(c is >= '0' and <= '9' or >= 'A' and <= 'F'))
            || !ulong.TryParse(text, NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var handle)
            || !handles.Add(handle))
            throw new InvalidDataException("DWG edit handle is invalid or duplicated.");
        return handle;
    }

    private static XYZ Point(JsonElement value, bool planar)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() != 3)
            throw new InvalidDataException("DWG edit point must have exactly three coordinates.");
        var numbers = value.EnumerateArray().Select(Number).ToArray();
        if (planar && numbers[2] != 0)
            throw new InvalidDataException("DWG v2 edit points must be planar WCS coordinates.");
        return new XYZ(numbers[0], numbers[1], numbers[2]);
    }

    private static double PositiveNumber(JsonElement value, string name)
    {
        var number = Number(value);
        if (number <= 0) throw new InvalidDataException($"DWG edit {name} must be positive.");
        return number;
    }

    private static double Number(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number)
            || !double.IsFinite(number) || Math.Abs(number) > MaximumNumber)
            throw new InvalidDataException("DWG edit number is non-finite or out of range.");
        return number;
    }

    private static void ValidateText(string text, bool allowEmpty)
    {
        if ((!allowEmpty && text.Length == 0) || text.Length > 10_000
            || text.Contains("%%", StringComparison.Ordinal) || text.Contains("%<", StringComparison.Ordinal))
            throw new InvalidDataException("DWG TEXT edit must be bounded plain single-line text.");
        for (var index = 0; index < text.Length; index++)
        {
            var character = text[index];
            if (char.IsControl(character) || character is '\u2028' or '\u2029')
                throw new InvalidDataException("DWG TEXT edit must be bounded plain single-line text.");
            if (char.IsHighSurrogate(character))
            {
                if (++index >= text.Length || !char.IsLowSurrogate(text[index]))
                    throw new InvalidDataException("DWG TEXT edit Unicode is malformed.");
            }
            else if (char.IsLowSurrogate(character))
                throw new InvalidDataException("DWG TEXT edit Unicode is malformed.");
        }
    }

    private static bool SamePoint(XYZ first, XYZ second) =>
        first.X == second.X && first.Y == second.Y && first.Z == second.Z;
}
