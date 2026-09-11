using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using ACadSharp;
using ACadSharp.Blocks;
using ACadSharp.Entities;
using ACadSharp.IO;
using ACadSharp.Tables;
using ACadSharp.Types.Units;
using CSMath;

namespace DwgEngineQualification;

internal static class NativeDwgStreamSelfTests
{
    private const string FailureDiagnostic = "native stream read failed.\n";

    public static void CliReadsRealDwgFromBinaryStandardInput()
    {
        var source = WriteFixture();
        var before = source.ToArray();
        var beforeSha = Convert.ToHexString(SHA256.HashData(source)).ToLowerInvariant();

        var (exitCode, output, error) = RunCli(source);

        Assert(exitCode == 0, "pipe reader succeeds");
        Assert(error.Length == 0, "pipe reader has no success diagnostic");
        Assert(source.SequenceEqual(before), "original caller bytes remain untouched");
        using var report = JsonDocument.Parse(output);
        var root = report.RootElement;
        Assert(root.GetProperty("schemaVersion").GetString() == "1hk-dwg-import/1", "one schemaVersion 1hk-dwg-import/1 report");
        Assert(root.GetProperty("source").GetProperty("sha256").GetString() == beforeSha, "same original bytes");
        Assert(root.GetProperty("coverage").GetProperty("importedEntities").GetInt32() == 5, "literal fixture projection");
        var line = root.GetProperty("entities").EnumerateArray().Single(entity => entity.GetProperty("type").GetString() == "LINE");
        AssertPoint(line.GetProperty("geometry").GetProperty("start"), 10, -5, 0, "literal LINE start");
        AssertPoint(line.GetProperty("geometry").GetProperty("end"), 125, 25, 0, "literal LINE end");
    }

    public static void ReadsNonSeekableChunkedInput()
    {
        var source = WriteFixture();
        var expectedSha = Convert.ToHexString(SHA256.HashData(source)).ToLowerInvariant();
        using var input = new ChunkedReadStream(source, 3);
        using var output = new MemoryStream();
        using var error = new StringWriter();

        var exitCode = NativeDwgReader.RunStream(input, output, error);

        Assert(exitCode == 0, "chunked non-seekable stream succeeds");
        Assert(error.ToString().Length == 0, "chunked success has no diagnostic");
        using var report = JsonDocument.Parse(output.ToArray());
        Assert(report.RootElement.GetProperty("source").GetProperty("sha256").GetString() == expectedSha, "chunked stream hashes exact bytes");
        Assert(report.RootElement.GetProperty("coverage").GetProperty("importedEntities").GetInt32() == 5, "chunked stream projects the fixture");
    }

    public static void RejectsMalformedStreamsWithoutSuccessOutput()
    {
        var valid = WriteFixture();
        var cases = new[]
        {
            Array.Empty<byte>(),
            "ZZ1024"u8.ToArray(),
            "AC1024"u8.ToArray(),
            valid[..(valid.Length / 2)],
        };

        foreach (var source in cases)
        {
            using var input = new ChunkedReadStream(source, 5);
            using var output = new MemoryStream();
            using var error = new StringWriter();

            var exitCode = NativeDwgReader.RunStream(input, output, error);

            Assert(exitCode != 0, "malformed stream is rejected");
            Assert(output.Length == 0, "malformed stream has no partial success report");
            Assert(error.ToString() == FailureDiagnostic, "malformed stream uses the fixed diagnostic");
        }
    }

    public static void RejectsOversizedGeneratedStreamWithoutSuccessOutput()
    {
        using var input = new GeneratedReadStream(200L * 1024 * 1024 + 1);
        using var output = new MemoryStream();
        using var error = new StringWriter();

        var exitCode = NativeDwgReader.RunStream(input, output, error);

        Assert(exitCode != 0, "oversized stream is rejected");
        Assert(output.Length == 0, "oversized stream has no partial success report");
        Assert(error.ToString() == FailureDiagnostic, "oversized stream uses the fixed diagnostic");
    }

    private static byte[] WriteFixture()
    {
        var document = new CadDocument(ACadVersion.AC1024);
        document.Header.InsUnits = UnitsType.Millimeters;
        var geometryLayer = new Layer("QA_GEOMETRY");
        var textLayer = new Layer("QA_TEXT") { IsOn = false, Flags = LayerFlags.Locked };
        document.Layers.Add(geometryLayer);
        document.Layers.Add(textLayer);
        document.Entities.Add(new Line(new XYZ(10, -5, 0), new XYZ(125, 25, 0)) { Layer = geometryLayer });
        document.Entities.Add(new Circle(new XYZ(50, 60, 0), 9) { Layer = geometryLayer });
        document.Entities.Add(new Arc(new XYZ(70, 80, 0), 11, 0.25, 2.5) { Layer = geometryLayer });
        document.Entities.Add(new LwPolyline([new XY(0, 0), new XY(15, 5), new XY(20, 30)])
        {
            IsClosed = true,
            Layer = geometryLayer,
        });
        document.Entities.Add(new TextEntity
        {
            InsertPoint = new XYZ(20, 30, 0),
            Height = 12,
            Value = "A-101",
            Layer = textLayer,
        });
        var block = new BlockRecord("QA_BLOCK");
        block.Entities.Add(new Line(new XYZ(0, 0, 0), new XYZ(8, 0, 0)));
        block.Entities.Add(new Circle(new XYZ(4, 4, 0), 2));
        document.BlockRecords.Add(block);
        document.Entities.Add(new Insert(block) { InsertPoint = new XYZ(100, 100, 0), Layer = geometryLayer });

        using var output = new MemoryStream();
        using (var writer = new DwgWriter(output, document)) writer.Write();
        return output.ToArray();
    }

    private static (int ExitCode, byte[] Output, string Error) RunCli(byte[] input)
    {
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Current executable path is unavailable.");
        var start = new ProcessStartInfo(executable)
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        if (Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase))
            start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        start.ArgumentList.Add("read-native-stdio");

        using var process = Process.Start(start) ?? throw new InvalidOperationException("Pipe reader process did not start.");
        using var output = new MemoryStream();
        var outputCopy = process.StandardOutput.BaseStream.CopyToAsync(output);
        var errorRead = process.StandardError.ReadToEndAsync();
        process.StandardInput.BaseStream.Write(input);
        process.StandardInput.Close();
        process.WaitForExit();
        outputCopy.GetAwaiter().GetResult();
        return (process.ExitCode, output.ToArray(), errorRead.GetAwaiter().GetResult());
    }

    private static void AssertPoint(JsonElement point, double x, double y, double z, string label)
    {
        Assert(point.GetArrayLength() == 3, label + " has three coordinates");
        Assert(point[0].GetDouble() == x && point[1].GetDouble() == y && point[2].GetDouble() == z, label);
    }

    private static void Assert(bool condition, string label)
    {
        if (!condition) throw new InvalidOperationException(label);
    }

    private sealed class ChunkedReadStream(byte[] bytes, int chunkSize) : Stream
    {
        private int _position;

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count)
        {
            var length = Math.Min(Math.Min(count, chunkSize), bytes.Length - _position);
            if (length <= 0) return 0;
            bytes.AsSpan(_position, length).CopyTo(buffer.AsSpan(offset, length));
            _position += length;
            return length;
        }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    private sealed class GeneratedReadStream(long length) : Stream
    {
        private static readonly byte[] Header = "AC1024"u8.ToArray();
        private long _position;

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count)
        {
            if (_position == length) return 0;
            var read = (int)Math.Min(count, length - _position);
            Array.Clear(buffer, offset, read);
            for (var index = 0; index < read && _position + index < Header.Length; index++)
                buffer[offset + index] = Header[_position + index];
            _position += read;
            return read;
        }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
