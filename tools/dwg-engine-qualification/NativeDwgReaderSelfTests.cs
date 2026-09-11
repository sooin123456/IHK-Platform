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

internal static class NativeDwgReaderSelfTests
{
    private static readonly object ConsoleCaptureLock = new();

    public static void ReadsRealDwgGeometryAndPreservesSource()
    {
        using var temp = TestDirectory.Create();
        var input = Path.Combine(temp.Path, "source.dwg");
        var outputDirectory = Path.Combine(temp.Path, "report");
        WriteFixture(input, includeUnsupportedVariants: false);
        var beforeSha = HashFile(input);

        var exitCode = ReadNativeCli(input, outputDirectory, out var commandOutput, out var commandError);

        AssertEqual(0, exitCode, "native read succeeds");
        AssertEqual("native-import.json", commandOutput.Trim(), "CLI success output");
        AssertEqual(string.Empty, commandError, "CLI success error output");
        AssertEqual(beforeSha, HashFile(input), "source bytes unchanged");
        AssertSequenceEqual(["native-import.json"], Directory.GetFileSystemEntries(outputDirectory).Select(Path.GetFileName).ToArray(), "single report artifact");

        using var report = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(outputDirectory, "native-import.json")));
        var root = report.RootElement;
        AssertKeys(root, "schemaVersion", "qualification", "source", "engine", "coordinateSystem", "unitCode", "modelSpaceHandle", "layers", "entities", "coverage", "unsupported", "readerNotificationCount");
        AssertKeys(root.GetProperty("source"), "sha256", "byteSize", "headerVersion");
        AssertKeys(root.GetProperty("engine"), "name", "version");
        AssertKeys(root.GetProperty("coverage"), "modelSpaceEntities", "importedEntities", "unsupportedEntities", "nonModelSpaceEntities");
        AssertEqual("1hk-dwg-import/1", root.GetProperty("schemaVersion").GetString(), "schema version");
        AssertEqual("experimental-unqualified", root.GetProperty("qualification").GetString(), "qualification");
        AssertEqual(beforeSha, root.GetProperty("source").GetProperty("sha256").GetString(), "report source hash");
        AssertEqual(new FileInfo(input).Length, root.GetProperty("source").GetProperty("byteSize").GetInt64(), "report source size");
        AssertEqual("AC1024", root.GetProperty("source").GetProperty("headerVersion").GetString(), "source header");
        AssertEqual("ACadSharp", root.GetProperty("engine").GetProperty("name").GetString(), "engine name");
        AssertEqual("3.7.1", root.GetProperty("engine").GetProperty("version").GetString(), "engine version");
        AssertEqual("WCS_NATIVE_UNITS", root.GetProperty("coordinateSystem").GetString(), "coordinate system");
        AssertEqual(4, root.GetProperty("unitCode").GetInt32(), "millimeter unit code");
        var textLayer = root.GetProperty("layers").EnumerateArray().Single(layer => layer.GetProperty("name").GetString() == "QA_TEXT");
        AssertKeys(textLayer, "handle", "name", "visible", "locked");
        AssertEqual(false, textLayer.GetProperty("visible").GetBoolean(), "layer visibility preserved");
        AssertEqual(true, textLayer.GetProperty("locked").GetBoolean(), "layer lock preserved");
        AssertCanonicalHandle(root.GetProperty("modelSpaceHandle").GetString(), "model-space handle");

        var entities = root.GetProperty("entities").EnumerateArray().ToArray();
        var line = entities.Single(entity => entity.GetProperty("type").GetString() == "LINE");
        AssertKeys(line, "handle", "ownerHandle", "layerHandle", "type", "geometry");
        AssertKeys(line.GetProperty("geometry"), "start", "end");
        AssertPoint(line.GetProperty("geometry").GetProperty("start"), 10, -5, 0, "WCS line start preserved");
        AssertPoint(line.GetProperty("geometry").GetProperty("end"), 125, 25, 0, "WCS line end preserved");
        var text = entities.Single(entity => entity.GetProperty("type").GetString() == "TEXT");
        AssertEqual("A-101", text.GetProperty("geometry").GetProperty("text").GetString(), "plain text preserved");
        AssertPoint(text.GetProperty("geometry").GetProperty("insert"), 20, 30, 0, "text insertion preserved");
        AssertEqual(12d, text.GetProperty("geometry").GetProperty("height").GetDouble(), "text height preserved");
        var circle = entities.Single(entity => entity.GetProperty("type").GetString() == "CIRCLE");
        AssertPoint(circle.GetProperty("geometry").GetProperty("center"), 50, 60, 0, "circle center preserved");
        AssertEqual(9d, circle.GetProperty("geometry").GetProperty("radius").GetDouble(), "circle radius preserved");
        var arc = entities.Single(entity => entity.GetProperty("type").GetString() == "ARC");
        AssertEqual(0.25d, arc.GetProperty("geometry").GetProperty("startAngleRadians").GetDouble(), "arc start angle preserved", 1e-12);
        AssertEqual(2.5d, arc.GetProperty("geometry").GetProperty("endAngleRadians").GetDouble(), "arc end angle preserved", 1e-12);
        var polyline = entities.Single(entity => entity.GetProperty("type").GetString() == "LWPOLYLINE");
        AssertEqual(true, polyline.GetProperty("geometry").GetProperty("closed").GetBoolean(), "polyline closure preserved");
        AssertPoint(polyline.GetProperty("geometry").GetProperty("points")[1], 15, 5, 0, "polyline vertex preserved");

        var coverage = root.GetProperty("coverage");
        AssertEqual(6, coverage.GetProperty("modelSpaceEntities").GetInt32(), "exact model count");
        AssertEqual(5, coverage.GetProperty("importedEntities").GetInt32(), "exact imported count");
        AssertEqual(1, coverage.GetProperty("unsupportedEntities").GetInt32(), "INSERT unsupported count");
        AssertEqual(3, coverage.GetProperty("nonModelSpaceEntities").GetInt32(), "ordinary block children plus default paper viewport count");
        AssertEqual("unsupported_type", root.GetProperty("unsupported")[0].GetProperty("reason").GetString(), "INSERT reason");

        var modelHandle = root.GetProperty("modelSpaceHandle").GetString();
        var layerHandles = root.GetProperty("layers").EnumerateArray().Select(layer => layer.GetProperty("handle").GetString()).ToHashSet(StringComparer.Ordinal);
        foreach (var entity in entities)
        {
            AssertCanonicalHandle(entity.GetProperty("handle").GetString(), "entity handle");
            AssertEqual(modelHandle, entity.GetProperty("ownerHandle").GetString(), "model owner identity");
            AssertEqual(true, layerHandles.Contains(entity.GetProperty("layerHandle").GetString()), "layer handle reference");
        }
    }

    public static void CountsUnsupportedGeometryWithoutFabrication()
    {
        using var temp = TestDirectory.Create();
        var input = Path.Combine(temp.Path, "variants.dwg");
        var outputDirectory = Path.Combine(temp.Path, "report");
        WriteFixture(input, includeUnsupportedVariants: true);

        var exitCode = ReadNative(input, outputDirectory);

        AssertEqual(0, exitCode, "variant read succeeds");
        using var report = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(outputDirectory, "native-import.json")));
        var root = report.RootElement;
        AssertEqual(9, root.GetProperty("coverage").GetProperty("modelSpaceEntities").GetInt32(), "exact variant model count");
        AssertEqual(5, root.GetProperty("coverage").GetProperty("importedEntities").GetInt32(), "only supported entities imported");
        AssertEqual(4, root.GetProperty("coverage").GetProperty("unsupportedEntities").GetInt32(), "all unsupported variants counted");
        AssertEqual(5, root.GetProperty("entities").GetArrayLength(), "unsupported geometry omitted from entities");
        var unsupported = root.GetProperty("unsupported").EnumerateArray().ToArray();
        AssertEqual(1, Count(unsupported, "LINE", "unsupported_geometry"), "nonplanar LINE count");
        AssertEqual(1, Count(unsupported, "LWPOLYLINE", "unsupported_geometry"), "bulged polyline count");
        AssertEqual(1, Count(unsupported, "TEXT", "unsupported_text"), "rotated text count");
        AssertEqual(1, Count(unsupported, "INSERT", "unsupported_type"), "insert count");
    }

    public static void KeepsAttributeDefinitionsOutOfPlainTextImport()
    {
        using var temp = TestDirectory.Create();
        var input = Path.Combine(temp.Path, "attribute-definition.dwg");
        var document = new CadDocument(ACadVersion.AC1024);
        document.Entities.Add(new AttributeDefinition
        {
            InsertPoint = new XYZ(10, 20, 0),
            Height = 4,
            Tag = "ROOM",
            Prompt = "Room number",
            Value = "ATTDEF-101",
        });
        document.Entities.Add(new TextEntity
        {
            InsertPoint = new XYZ(30, 40, 0),
            Height = 4,
            Value = "TEXT-101",
        });
        using (var writer = new DwgWriter(input, document)) writer.Write();
        var outputDirectory = Path.Combine(temp.Path, "report");

        var exitCode = ReadNative(input, outputDirectory);

        AssertEqual(0, exitCode, "attribute-definition fixture read succeeds");
        using var report = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(outputDirectory, "native-import.json")));
        var root = report.RootElement;
        var entities = root.GetProperty("entities").EnumerateArray().ToArray();
        AssertEqual(1, entities.Length, "only exact plain TEXT is imported");
        AssertEqual("TEXT", entities[0].GetProperty("type").GetString(), "ordinary TEXT category preserved");
        AssertEqual("TEXT-101", entities[0].GetProperty("geometry").GetProperty("text").GetString(), "ordinary TEXT value preserved");
        var unsupported = root.GetProperty("unsupported").EnumerateArray().ToArray();
        AssertEqual(1, Count(unsupported, "ATTDEF", "unsupported_type"), "ATTDEF retains its unsupported category");
        AssertEqual(2, root.GetProperty("coverage").GetProperty("modelSpaceEntities").GetInt32(), "exact attribute fixture model count");
        AssertEqual(1, root.GetProperty("coverage").GetProperty("importedEntities").GetInt32(), "exact attribute fixture imported count");
        AssertEqual(1, root.GetProperty("coverage").GetProperty("unsupportedEntities").GetInt32(), "exact attribute fixture unsupported count");
    }

    public static void RejectsMalformedInputAndExistingOutput()
    {
        using var temp = TestDirectory.Create();
        var malformed = Path.Combine(temp.Path, "malformed.dwg");
        File.WriteAllBytes(malformed, "AC1024"u8.ToArray());
        var malformedOutput = Path.Combine(temp.Path, "malformed-report");
        var malformedExit = ReadNative(malformed, malformedOutput);
        AssertEqual(true, malformedExit != 0, "header-only input rejected");
        AssertEqual(false, File.Exists(Path.Combine(malformedOutput, "native-import.json")), "invalid input leaves no success report");

        var valid = Path.Combine(temp.Path, "valid.dwg");
        WriteFixture(valid, includeUnsupportedVariants: false);
        var existingOutput = Path.Combine(temp.Path, "existing");
        Directory.CreateDirectory(existingOutput);
        var existingExit = ReadNative(valid, existingOutput);
        AssertEqual(true, existingExit != 0, "existing output directory rejected");
        AssertEqual(0, Directory.GetFileSystemEntries(existingOutput).Length, "existing output remains untouched");
    }

    public static void RejectsExternalReferencesWithoutOutput()
    {
        using var temp = TestDirectory.Create();
        var input = Path.Combine(temp.Path, "xref.dwg");
        var document = new CadDocument(ACadVersion.AC1024);
        var block = new BlockRecord("QA_XREF");
        block.BlockEntity.Flags = BlockTypeFlags.XRef;
        block.BlockEntity.XRefPath = "untrusted-relative-reference.dwg";
        document.BlockRecords.Add(block);
        document.Entities.Add(new Insert(block));
        using (var writer = new DwgWriter(input, document)) writer.Write();
        var outputDirectory = Path.Combine(temp.Path, "report");

        var exitCode = ReadNative(input, outputDirectory);

        AssertEqual(true, exitCode != 0, "external reference rejected");
        AssertEqual(false, Directory.Exists(outputDirectory), "external reference leaves no output directory");
    }

    public static void AcceptsFullTurnArcAndPlinegenPolyline()
    {
        using var temp = TestDirectory.Create();
        var input = Path.Combine(temp.Path, "standard-flags.dwg");
        var document = new CadDocument(ACadVersion.AC1024);
        document.Entities.Add(new Arc(new XYZ(4, 5, 0), 3, 0, Math.PI * 2));
        document.Entities.Add(new LwPolyline([new XY(0, 0), new XY(10, 0), new XY(10, 10)])
        {
            Flags = LwPolylineFlags.Plinegen,
        });
        using (var writer = new DwgWriter(input, document)) writer.Write();
        var outputDirectory = Path.Combine(temp.Path, "report");

        var exitCode = ReadNative(input, outputDirectory);

        AssertEqual(0, exitCode, "standard ARC/LWPOLYLINE variants read");
        using var report = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(outputDirectory, "native-import.json")));
        var entities = report.RootElement.GetProperty("entities").EnumerateArray().ToArray();
        var arc = entities.Single(entity => entity.GetProperty("type").GetString() == "ARC");
        AssertEqual(0d, arc.GetProperty("geometry").GetProperty("startAngleRadians").GetDouble(), "full-turn start angle");
        AssertEqual(Math.PI * 2, arc.GetProperty("geometry").GetProperty("endAngleRadians").GetDouble(), "full-turn end angle", 1e-12);
        AssertEqual(1, entities.Count(entity => entity.GetProperty("type").GetString() == "LWPOLYLINE"), "PLINEGEN remains supported");
        AssertEqual(0, report.RootElement.GetProperty("coverage").GetProperty("unsupportedEntities").GetInt32(), "standard variants are not unsupported");
    }

    public static void CountsClassicPolylineVerticesInGlobalBudget()
    {
        using var temp = TestDirectory.Create();
        var input = Path.Combine(temp.Path, "classic-polyline-budget.dwg");
        var document = new CadDocument(ACadVersion.AC1024);
        var polyline = new Polyline2D();
        for (var index = 0; index < 100_001; index++)
            polyline.Vertices.Add(new Vertex2D { Location = new XYZ(index % 1000, index / 1000, 0) });
        document.Entities.Add(polyline);
        using (var writer = new DwgWriter(input, document)) writer.Write();
        var outputDirectory = Path.Combine(temp.Path, "report");

        var exitCode = ReadNative(input, outputDirectory);

        AssertEqual(true, exitCode != 0, "classic polyline vertex overflow rejected");
        AssertEqual(false, Directory.Exists(outputDirectory), "vertex overflow leaves no output directory");
    }

    public static void ConcurrentOutputHasOneOwnerAndOneReport()
    {
        using var temp = TestDirectory.Create();
        var input = Path.Combine(temp.Path, "source.dwg");
        WriteFixture(input, includeUnsupportedVariants: false);
        var outputDirectory = Path.Combine(temp.Path, "shared-report");
        using var gate = new ManualResetEventSlim(false);
        var attempts = Enumerable.Range(0, 8).Select(_ => Task.Run(() =>
        {
            gate.Wait();
            return ReadNative(input, outputDirectory);
        })).ToArray();

        gate.Set();
        Task.WaitAll(attempts);

        AssertEqual(1, attempts.Count(attempt => taskResult(attempt) == 0), "exactly one output owner succeeds");
        AssertEqual(true, File.Exists(Path.Combine(outputDirectory, "native-import.json")), "winning report survives losing cleanup");
        AssertSequenceEqual(["native-import.json"], Directory.GetFileSystemEntries(outputDirectory).Select(Path.GetFileName), "concurrent output contains one report");

        static int taskResult(Task<int> task) => task.GetAwaiter().GetResult();
    }

    public static void RejectsCorruptionInsteadOfReportingFailsafeCoverage()
    {
        using var temp = TestDirectory.Create();
        var input = Path.Combine(temp.Path, "source.dwg");
        WriteFixture(input, includeUnsupportedVariants: false);
        var source = File.ReadAllBytes(input);
        AssertEqual(true, source.Length > 6_595, "synthetic corruption offset exists");
        source[6_595] ^= 1;
        File.WriteAllBytes(input, source);
        var outputDirectory = Path.Combine(temp.Path, "report");

        var exitCode = ReadNative(input, outputDirectory);

        AssertEqual(true, exitCode != 0, "corrupt DWG is rejected instead of reported as complete coverage");
        AssertEqual(false, Directory.Exists(outputDirectory), "corrupt DWG leaves no output directory");
    }

    private static int ReadNativeCli(string input, string outputDirectory, out string commandOutput, out string commandError)
    {
        lock (ConsoleCaptureLock)
        {
            var previousOutput = Console.Out;
            var previousError = Console.Error;
            using var output = new StringWriter();
            using var error = new StringWriter();
            try
            {
                Console.SetOut(output);
                Console.SetError(error);
                var result = Program.Main(["read-native", "--input", input, "--output-dir", outputDirectory]);
                commandOutput = output.ToString();
                commandError = error.ToString();
                return result;
            }
            finally
            {
                Console.SetOut(previousOutput);
                Console.SetError(previousError);
            }
        }
    }

    private static int ReadNative(string input, string outputDirectory)
    {
        using var output = new StringWriter();
        using var error = new StringWriter();
        return NativeDwgReader.Run(input, outputDirectory, output, error);
    }

    private static int Count(IEnumerable<JsonElement> groups, string type, string reason) => groups
        .Single(group => group.GetProperty("type").GetString() == type && group.GetProperty("reason").GetString() == reason)
        .GetProperty("count").GetInt32();

    private static void WriteFixture(string path, bool includeUnsupportedVariants)
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

        if (includeUnsupportedVariants)
        {
            document.Entities.Add(new Line(new XYZ(0, 0, 3), new XYZ(10, 0, 3)) { Layer = geometryLayer });
            var bulged = new LwPolyline([new XY(0, 0), new XY(10, 0)]) { Layer = geometryLayer };
            bulged.Vertices[0].Bulge = 0.5;
            document.Entities.Add(bulged);
            document.Entities.Add(new TextEntity
            {
                InsertPoint = new XYZ(0, 0, 0),
                Height = 5,
                Value = "ROTATED",
                Rotation = 0.5,
                Layer = textLayer,
            });
        }

        using var writer = new DwgWriter(path, document);
        writer.Write();
    }

    private static string HashFile(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    private static void AssertPoint(JsonElement point, double x, double y, double z, string label)
    {
        AssertEqual(x, point[0].GetDouble(), label + " x", 1e-12);
        AssertEqual(y, point[1].GetDouble(), label + " y", 1e-12);
        AssertEqual(z, point[2].GetDouble(), label + " z", 1e-12);
    }

    private static void AssertKeys(JsonElement value, params string[] expected)
    {
        var actual = value.EnumerateObject().Select(property => property.Name).OrderBy(name => name, StringComparer.Ordinal);
        var sortedExpected = expected.OrderBy(name => name, StringComparer.Ordinal);
        AssertSequenceEqual(sortedExpected, actual, "exact JSON keys");
    }

    private static void AssertCanonicalHandle(string? value, string label)
    {
        var valid = value is { Length: >= 1 and <= 16 }
            && value[0] != '0'
            && value.All(character => character is >= '0' and <= '9' or >= 'A' and <= 'F');
        AssertEqual(true, valid, label);
    }

    private static void AssertEqual<T>(T expected, T actual, string label)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new InvalidOperationException($"{label}: expected {expected}, got {actual}");
    }

    private static void AssertSequenceEqual<T>(IEnumerable<T> expected, IEnumerable<T> actual, string label)
    {
        if (!expected.SequenceEqual(actual))
            throw new InvalidOperationException($"{label}: expected [{string.Join(", ", expected)}], got [{string.Join(", ", actual)}]");
    }

    private static void AssertEqual(double expected, double actual, string label, double tolerance)
    {
        if (!double.IsFinite(actual) || Math.Abs(expected - actual) > tolerance)
            throw new InvalidOperationException($"{label}: expected {expected:R}, got {actual:R}");
    }

    private sealed class TestDirectory : IDisposable
    {
        public string Path { get; }

        private TestDirectory(string path) => Path = path;

        public static TestDirectory Create()
        {
            var path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"native-dwg-reader-test-{Guid.NewGuid():N}");
            Directory.CreateDirectory(path);
            return new TestDirectory(path);
        }

        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
