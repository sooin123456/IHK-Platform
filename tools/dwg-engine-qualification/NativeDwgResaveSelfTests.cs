using System.Buffers.Binary;
using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using ACadSharp;
using ACadSharp.Entities;
using ACadSharp.IO;
using ACadSharp.Tables;
using ACadSharp.Types.Units;
using CSMath;

namespace DwgEngineQualification;

internal static class NativeDwgResaveSelfTests
{
    internal static void DetectsPassiveViewportChanges()
    {
        var document = new CadDocument(ACadVersion.AC1024);
        var viewport = document.BlockRecords.SelectMany(block => block.Entities).OfType<Viewport>().Single();
        viewport.Center = new XYZ(10, 20, 0);
        viewport.Width = 200;
        viewport.Height = 100;
        viewport.ViewHeight = 500;
        var first = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
        var second = new Line(new XYZ(0, 1, 0), new XYZ(10, 1, 0));
        document.Entities.Add(first);
        document.Entities.Add(second);
        viewport.Boundary = first;
        CadInventory Snapshot() => QualificationRunner.Inventory(document, new List<string>());
        var baseline = Snapshot();
        Assert(baseline.Diagnostics!.Count == 0, "ordinary viewport has supported passive inventory");
        var handle = viewport.Handle.ToString("X");
        Assert(baseline.Entities.Single(entity => entity.Handle == handle).Geometry.Contains("center=10,20,0;width=200;height=100;"), "literal stored viewport geometry");
        void Changed(string field) => Assert(SemanticComparer.Compare(baseline, Snapshot(), ExpectedEdits.None, 1e-9).Failures.Contains($"untouched entity {handle} {field} changed"), "detect changed viewport " + field);
        viewport.Width = 201;
        Changed("geometry");
        viewport.Width = 200;
        viewport.StyleSheetName = "plot-2.ctb";
        Changed("reference");
        viewport.StyleSheetName = null;
        viewport.Boundary = second;
        Changed("reference");
        viewport.Boundary = first;
        typeof(CadObject).GetProperty(nameof(CadObject.Owner))!.SetValue(viewport, document.ModelSpace);
        Changed("owner");
    }

    internal static void ResavesChunkedNonSeekableInput()
    {
        var (source, request) = Fixture();
        using var input = new ChunkedReadStream(Frame(request, source));
        using var output = new MemoryStream();
        using var error = new StringWriter();
        Assert(NativeDwgResaver.RunStream(input, output, error) == 0, "chunked resave succeeds");
        Assert(error.ToString().Length == 0, "chunked resave has no stderr");
        VerifySuccess(source, request, output.ToArray());
    }

    internal static void RejectsMalformedFramesAndRequests()
    {
        var (source, request) = Fixture();
        var valid = Frame(request, source);
        for (var length = 0; length < 16; length++) Reject(valid[..length], "truncated header " + length);
        Reject(valid[..^1], "truncated source");
        Reject(valid[..20], "truncated request");
        Reject([.. valid, 0], "trailing byte");
        var wrongMagic = valid.ToArray();
        wrongMagic[7] = (byte)'2';
        Reject(wrongMagic, "wrong protocol magic/version");
        foreach (var (requestLength, sourceLength) in new (uint, uint)[]
        {
            (0, 6), (2097153, 6), (uint.MaxValue, 6), (1, 0), (1, 5), (1, 209715201), (1, uint.MaxValue),
        })
        {
            var header = valid[..16];
            BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(8, 4), requestLength);
            BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(12, 4), sourceLength);
            using var input = new ChunkedReadStream(header, failAfterEnd: true);
            Reject(input, "declared length rejected before reading/allocating payload");
            Assert(!input.ReadPastEnd, "invalid declared length never reads payload");
        }
        Reject(Frame([0xFF], source), "invalid UTF-8");
        Reject(Frame([239, 187, 191, .. request], source), "UTF-8 BOM");
        Reject(Frame(Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(request).Replace("\"schemaVersion\":", "\"schemaVersion\":\"1hk-dwg-edits/2\",\"schemaVersion\":")), source), "duplicate JSON keys");
        void InvalidRequest(Action<JsonObject> mutate, string name)
        {
            var json = JsonNode.Parse(request)!.AsObject();
            mutate(json);
            Reject(Frame(JsonSerializer.SerializeToUtf8Bytes(json), source), name);
        }
        InvalidRequest(json => json["schemaVersion"] = "1hk-dwg-edits/1", "version 1");
        // A genuinely valid v1 LINE request must also be rejected by this command.
        InvalidRequest(json => { json["schemaVersion"] = "1hk-dwg-edits/1"; json["edits"] = new JsonArray(json["edits"]![1]!.DeepClone()); }, "valid v1 request");
        InvalidRequest(json => json["sourceSha256"] = new string('0', 64), "stale source hash");
        InvalidRequest(json => json["edits"] = new JsonArray(), "no implicit edit for empty request");
        InvalidRequest(json => json["edits"]![1]!["handle"] = "FFFFFFFFFFFFFFFF", "invalid batch target");
        InvalidRequest(json => json["edits"]![1]!["handle"] = json["edits"]![0]!["handle"]!.DeepClone(), "duplicate target");
        InvalidRequest(json => json["edits"]![1]!["start"]![2] = 1, "nonplanar edit");
        foreach (var corrupt in new[] { "ZZ1024"u8.ToArray(), "AC1024"u8.ToArray(), source[..(source.Length / 2)] })
        {
            var json = JsonNode.Parse(request)!.AsObject();
            json["sourceSha256"] = Sha(corrupt);
            Reject(Frame(JsonSerializer.SerializeToUtf8Bytes(json), corrupt), "malformed native source");
        }
        var extraArgs = RunCli(valid, "unexpected");
        Assert(extraArgs.ExitCode != 0 && extraArgs.Output.Length == 0 && extraArgs.Error == "native stream resave failed.\n", "extra CLI arguments are rejected generically");
    }

    internal static void RejectsInventoryGapsAndIneligibleSources()
    {
        foreach (var customize in new Action<CadDocument>[]
        {
            doc => doc.Entities.Add(new ACadSharp.Entities.Point()),
            doc => doc.BlockRecords.Single(block => block.Name == "UNTOUCHED_BLOCK").BlockEntity.XRefPath = "https://invalid.example/private-source.dwg",
            doc => doc.Entities.OfType<Line>().Last().Normal = new XYZ(0, 1, 0),
        })
        {
            var (source, request) = Fixture(customize);
            Reject(Frame(request, source), "gap/xref/ineligible selected geometry");
        }
    }

    internal static void BoundsOutputMemoryBeforeGrowth()
    {
        using var stream = new NativeDwgResaver.BoundedMemoryStream(17);
        stream.Write(new byte[16]);
        stream.WriteByte(1);
        Assert(stream.Length == 17 && stream.Capacity <= 17, "output accepts exact byte budget without oversized backing array");
        foreach (var write in new Action[] { () => stream.WriteByte(0), () => stream.Write(new byte[1]), () => stream.Write(new byte[1], 0, 1), () => stream.SetLength(18) })
        {
            var rejected = false;
            try { write(); } catch (InvalidDataException) { rejected = true; }
            Assert(rejected && stream.Length == 17 && stream.Capacity <= 17, "output overflow rejected before growth");
        }
    }

    private static void Reject(byte[] frame, string name)
    {
        using var input = new ChunkedReadStream(frame);
        Reject(input, name);
    }

    private static void Reject(Stream input, string name)
    {
        using var output = new MemoryStream();
        using var error = new StringWriter();
        Assert(NativeDwgResaver.RunStream(input, output, error) != 0, name + " rejects");
        Assert(output.Length == 0, name + " publishes no success bytes");
        Assert(error.ToString() == "native stream resave failed.\n", name + " fixed diagnostic");
    }

    private sealed class ChunkedReadStream(byte[] bytes, bool failAfterEnd = false) : Stream
    {
        private int position;
        internal bool ReadPastEnd { get; private set; }
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count)
        {
            if (position == bytes.Length && failAfterEnd) { ReadPastEnd = true; throw new InvalidOperationException("Payload must not be read"); }
            var length = Math.Min(Math.Min(5, count), bytes.Length - position);
            bytes.AsSpan(position, length).CopyTo(buffer.AsSpan(offset, length));
            position += length;
            return length;
        }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    // Catches an absent CLI command, implicit first-entity edits, incorrect geometry,
    // extra public fields, unbound hashes and incomplete binary publication.
    internal static void CliResavesExactRequestedGeometry()
    {
        var (source, request) = Fixture();
        var sourceBefore = source.ToArray();
        var requestBefore = request.ToArray();
        var (exitCode, frame, error) = RunCli(Frame(request, source));
        Assert(exitCode == 0, $"resave CLI succeeds (exit={exitCode}, stderr={error.Trim()})");
        Assert(error.Length == 0, "successful resave has no stderr");
        VerifySuccess(source, request, frame);
        Assert(source.SequenceEqual(sourceBefore) && request.SequenceEqual(requestBefore), "caller bytes unchanged");
    }

    private static void VerifySuccess(byte[] source, byte[] request, byte[] frame)
    {
        Assert(frame.Length >= 16 && frame.AsSpan(0, 8).SequenceEqual("1HKRSO01"u8), "resave output magic");
        var reportLength = checked((int)BinaryPrimitives.ReadUInt32BigEndian(frame.AsSpan(8, 4)));
        var dwgLength = checked((int)BinaryPrimitives.ReadUInt32BigEndian(frame.AsSpan(12, 4)));
        Assert(reportLength is >= 1 and <= 1048576 && dwgLength is >= 6 and <= 209715200, "output budgets");
        Assert(frame.Length == 16 + reportLength + dwgLength, "exact complete output frame");
        var reportBytes = frame.AsSpan(16, reportLength).ToArray();
        _ = new UTF8Encoding(false, true).GetString(reportBytes);
        Assert(!reportBytes.AsSpan().StartsWith(new byte[] { 239, 187, 191 }), "report has no BOM");
        using var report = JsonDocument.Parse(reportBytes);
        var root = report.RootElement;
        Keys(root, "schemaVersion", "qualification", "persistenceAuthority", "source", "request", "output", "engine", "verification");
        Assert(root.GetProperty("schemaVersion").GetString() == "1hk-dwg-resave/1", "literal report schema");
        Assert(root.GetProperty("qualification").GetString() == "experimental-unqualified", "literal qualification");
        Assert(root.GetProperty("persistenceAuthority").GetString() == "not-issued", "no authority issued");
        var dwg = frame.AsSpan(16 + reportLength, dwgLength).ToArray();
        foreach (var (name, bytes) in new[] { ("source", source), ("output", dwg) })
        {
            var identity = root.GetProperty(name);
            Keys(identity, "sha256", "byteSize", "headerVersion");
            Assert(identity.GetProperty("sha256").GetString() == Sha(bytes), name + " exact hash");
            Assert(identity.GetProperty("byteSize").GetInt32() == bytes.Length, name + " exact byte size");
            Assert(identity.GetProperty("headerVersion").GetString() == "AC1024", name + " literal header");
        }
        var requestReport = root.GetProperty("request");
        Keys(requestReport, "schemaVersion", "sha256", "byteSize", "handles");
        Assert(requestReport.GetProperty("schemaVersion").GetString() == "1hk-dwg-edits/2", "v2 report");
        Assert(requestReport.GetProperty("sha256").GetString() == Sha(request), "exact request hash");
        Assert(requestReport.GetProperty("byteSize").GetInt32() == request.Length, "exact request size");
        using var parsedRequest = JsonDocument.Parse(request);
        var handles = parsedRequest.RootElement.GetProperty("edits").EnumerateArray().Select(edit => edit.GetProperty("handle").GetString()!).ToArray();
        Assert(requestReport.GetProperty("handles").EnumerateArray().Select(item => item.GetString()).SequenceEqual(handles), "request handle order");
        var engine = root.GetProperty("engine");
        Keys(engine, "name", "version");
        Assert(engine.GetProperty("name").GetString() == "ACadSharp" && engine.GetProperty("version").GetString() == "3.7.1", "pinned engine");
        var verification = root.GetProperty("verification");
        Keys(verification, "noEditRoundTrip", "selectedEditRoundTrip", "geometryTolerance", "inventoriedEntityCount", "editedEntityCount", "inventoryCoverage", "independentCad");
        Assert(verification.GetProperty("noEditRoundTrip").GetString() == "passed", "no-edit verification");
        Assert(verification.GetProperty("selectedEditRoundTrip").GetString() == "passed", "selected verification");
        Assert(verification.GetProperty("geometryTolerance").GetDouble() == 1e-9, "geometry tolerance");
        Assert(verification.GetProperty("editedEntityCount").GetInt32() == 6, "six edited entities");
        Assert(verification.GetProperty("inventoriedEntityCount").GetInt32() == 9, "full model, viewport and block inventory");
        Assert(verification.GetProperty("inventoryCoverage").GetString() == "supported-fields-only", "inventory limitation");
        Assert(verification.GetProperty("independentCad").GetString() == "not-performed", "no independent qualification");

        using var stream = new MemoryStream(dwg);
        using var reader = new DwgReader(stream);
        reader.Configuration.Failsafe = false;
        var document = reader.Read();
        Entity Selected(int index) => document.Entities.Single(entity => entity.Handle.ToString("X") == handles[index]);
        var text = (TextEntity)Selected(0);
        Assert(text.InsertPoint == new XYZ(18, 20, 0) && text.Height == 4 && text.Value == "선택 문자 v2", "literal TEXT result");
        var line = (Line)Selected(1);
        Assert(line.StartPoint == new XYZ(2, 4, 0) && line.EndPoint == new XYZ(175, 35, 0), "literal requested LINE end");
        var polyline = (LwPolyline)Selected(2);
        Assert(polyline.IsClosed && polyline.Flags.HasFlag(LwPolylineFlags.Plinegen) && polyline.Vertices.Count == 3, "polyline closure and metadata");
        Assert(polyline.Vertices[0].Location == new XY(3, 5) && polyline.Vertices[1].Location == new XY(7, 11) && polyline.Vertices[2].Location == new XY(13, 5), "literal polyline vertices");
        var circle = (Circle)Selected(3);
        Assert(circle.Center == new XYZ(12, 14, 0) && circle.Radius == 7, "literal circle");
        var wrapped = (Arc)Selected(4);
        Assert(wrapped.Center == new XYZ(30, 35, 0) && wrapped.Radius == 9 && wrapped.StartAngle == 5.5 && wrapped.EndAngle == 1.25, "literal wrapped arc");
        var fullTurn = (Arc)Selected(5);
        Assert(fullTurn.Center == new XYZ(50, 55, 0) && fullTurn.Radius == 11 && fullTurn.StartAngle == 0 && fullTurn.EndAngle == 6.283185307179586, "literal full-turn arc");
        var untouched = document.Entities.OfType<Line>().Single(entity => entity.Handle.ToString("X") != handles[1]);
        Assert(untouched.StartPoint == new XYZ(70, 75, 0) && untouched.EndPoint == new XYZ(80, 85, 0), "first LINE untouched");
        var blockLine = document.BlockRecords.Single(block => block.Name == "UNTOUCHED_BLOCK").Entities.OfType<Line>().Single();
        Assert(blockLine.StartPoint == new XYZ(1, 1, 0) && blockLine.EndPoint == new XYZ(5, 1, 0), "block geometry untouched");
        Assert(document.Header.InsUnits == UnitsType.Millimeters, "source units preserved");
        Assert(document.BlockRecords.SelectMany(block => block.Entities).OfType<Viewport>().Single().RepresentsPaper, "ordinary paper viewport retained");
    }

    private static (byte[] Source, byte[] Request) Fixture(Action<CadDocument>? customize = null)
    {
        var document = new CadDocument(ACadVersion.AC1024);
        document.Header.InsUnits = UnitsType.Millimeters;
        document.Entities.Add(new Line(new XYZ(70, 75, 0), new XYZ(80, 85, 0)));
        var line = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
        var polyline = new LwPolyline([new XY(0, 10), new XY(10, 15), new XY(20, 10)]) { Flags = LwPolylineFlags.Plinegen };
        var circle = new Circle(new XYZ(20, 20, 0), 5);
        var wrapped = new Arc(new XYZ(30, 30, 0), 6, 5, 1);
        var fullTurn = new Arc(new XYZ(50, 50, 0), 8, 0, 6.283185307179586);
        var text = new TextEntity { InsertPoint = new XYZ(10, 20, 0), Height = 3, Value = "EDIT ME" };
        foreach (var entity in new Entity[] { line, polyline, circle, wrapped, fullTurn, text }) document.Entities.Add(entity);
        var blockRecord = new BlockRecord("UNTOUCHED_BLOCK");
        blockRecord.Entities.Add(new Line(new XYZ(1, 1, 0), new XYZ(5, 1, 0)));
        document.BlockRecords.Add(blockRecord);
        customize?.Invoke(document);
        using var output = new MemoryStream();
        using (var writer = new DwgWriter(output, document)) writer.Write();
        var source = output.ToArray();
        var request = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = "1hk-dwg-edits/2", sourceSha256 = Sha(source), coordinateSystem = "WCS_NATIVE_UNITS",
            edits = new object[]
            {
                new { handle = text.Handle.ToString("X"), type = "TEXT", insert = new[] { 18, 20, 0 }, height = 4, text = "선택 문자 v2" },
                new { handle = line.Handle.ToString("X"), type = "LINE", start = new[] { 2, 4, 0 }, end = new[] { 175, 35, 0 } },
                new { handle = polyline.Handle.ToString("X"), type = "LWPOLYLINE", points = new[] { new[] { 3, 5, 0 }, new[] { 7, 11, 0 }, new[] { 13, 5, 0 } }, closed = true },
                new { handle = circle.Handle.ToString("X"), type = "CIRCLE", center = new[] { 12, 14, 0 }, radius = 7 },
                new { handle = wrapped.Handle.ToString("X"), type = "ARC", center = new[] { 30, 35, 0 }, radius = 9, startAngleRadians = 5.5, endAngleRadians = 1.25 },
                new { handle = fullTurn.Handle.ToString("X"), type = "ARC", center = new[] { 50, 55, 0 }, radius = 11, startAngleRadians = 0d, endAngleRadians = 6.283185307179586 },
            },
        });
        return (source, request);
    }

    private static byte[] Frame(byte[] request, byte[] source)
    {
        var frame = new byte[16 + request.Length + source.Length];
        "1HKRSV01"u8.CopyTo(frame);
        BinaryPrimitives.WriteUInt32BigEndian(frame.AsSpan(8, 4), (uint)request.Length);
        BinaryPrimitives.WriteUInt32BigEndian(frame.AsSpan(12, 4), (uint)source.Length);
        request.CopyTo(frame, 16);
        source.CopyTo(frame, 16 + request.Length);
        return frame;
    }

    private static (int ExitCode, byte[] Output, string Error) RunCli(byte[] input, params string[] extraArguments)
    {
        var executable = Environment.ProcessPath!;
        var start = new ProcessStartInfo(executable) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        if (Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase))
            start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        start.ArgumentList.Add("resave-native-stdio");
        foreach (var argument in extraArguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start)!;
        using var output = new MemoryStream();
        var outputCopy = process.StandardOutput.BaseStream.CopyToAsync(output);
        var errorRead = process.StandardError.ReadToEndAsync();
        try { process.StandardInput.BaseStream.Write(input); }
        catch (IOException) { /* The pre-implementation CLI closes stdin on an unknown command. */ }
        process.StandardInput.Close();
        if (!process.WaitForExit(30_000)) { process.Kill(entireProcessTree: true); throw new InvalidOperationException("resave CLI timeout"); }
        outputCopy.GetAwaiter().GetResult();
        return (process.ExitCode, output.ToArray(), errorRead.GetAwaiter().GetResult());
    }

    private static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static void Keys(JsonElement value, params string[] keys) => Assert(value.EnumerateObject().Select(property => property.Name).Order().SequenceEqual(keys.Order()), "strict public report fields");
    private static void Assert(bool condition, string label) { if (!condition) throw new InvalidOperationException(label); }
}
