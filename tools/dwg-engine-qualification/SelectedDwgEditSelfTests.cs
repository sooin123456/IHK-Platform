using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using ACadSharp;
using ACadSharp.Entities;
using ACadSharp.IO;
using ACadSharp.Tables;
using ACadSharp.Types.Units;
using CSMath;

namespace DwgEngineQualification;

internal static class SelectedDwgEditSelfTests
{
    // Catches the former implicit First() selection and any bypass of requested handles.
    internal static void NoImplicitEdits()
    {
        using var fixture = new Fixture();
        Equal(0, Program.Main(["qualify", "--input", fixture.Input, "--output-dir", fixture.Output]));
        Equal(false, File.Exists(Path.Combine(fixture.Output, "edited-roundtrip.dwg")));
        using var report = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(fixture.Output, "qualification-report.json")));
        Equal(JsonValueKind.Null, report.RootElement.GetProperty("editedRoundTrip").ValueKind);
        Equal(fixture.SourceSha, Sha(File.ReadAllBytes(fixture.Input)));
    }

    internal static void EditsSelectedHandles()
    {
        using var fixture = new Fixture();
        var requestBytes = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = "1hk-dwg-edits/1",
            sourceSha256 = fixture.SourceSha,
            coordinateSystem = "WCS_NATIVE_UNITS",
            edits = new object[]
            {
                new { handle = fixture.TargetLine, type = "LINE", start = new[] { 4d, 5d, 6d }, end = new[] { 24d, 35d, 46d } },
                new { handle = fixture.TargetText, type = "TEXT", text = "선택한 문자 수정" },
            },
        });
        File.WriteAllBytes(fixture.Request, requestBytes);
        Equal(0, Program.Main(["qualify", "--input", fixture.Input, "--output-dir", fixture.Output, "--edits", fixture.Request]));

        using var reader = new DwgReader(Path.Combine(fixture.Output, "edited-roundtrip.dwg"));
        var result = reader.Read();
        var lines = result.Entities.OfType<Line>().ToArray();
        Equal(new XYZ(0, 0, 0), lines[0].StartPoint);
        Equal(new XYZ(10, 0, 0), lines[0].EndPoint);
        Equal(new XYZ(4, 5, 6), lines[1].StartPoint);
        Equal(new XYZ(24, 35, 46), lines[1].EndPoint);
        Equal(2d, lines[1].Thickness);
        Equal(fixture.TargetLine, lines[1].Handle.ToString("X"));
        var texts = result.Entities.OfType<TextEntity>().ToArray();
        Equal("DO NOT EDIT", texts[0].Value);
        Equal("선택한 문자 수정", texts[1].Value);
        Equal(new XYZ(20, 30, 0), texts[1].InsertPoint);
        Equal(3d, texts[1].Height);
        Equal(fixture.TargetText, texts[1].Handle.ToString("X"));
        Equal(fixture.SourceSha, Sha(File.ReadAllBytes(fixture.Input)));
        Equal(fixture.SourceSha, Sha(File.ReadAllBytes(Path.Combine(fixture.Output, "input-working-copy.dwg"))));
        Equal(Sha(requestBytes), Sha(File.ReadAllBytes(Path.Combine(fixture.Output, "edit-request.json"))));
        using var report = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(fixture.Output, "qualification-report.json")));
        Equal("not-qualified", report.RootElement.GetProperty("productionDwgDeliveryQualification").GetString());
        Equal(Sha(requestBytes), report.RootElement.GetProperty("editRequest").GetProperty("sha256").GetString());
        Equal(0, report.RootElement.GetProperty("editedRoundTrip").GetProperty("failures").GetArrayLength());
    }

    internal static void RejectsInvalidEdits()
    {
        var cases = new (string Name, Action<JsonObject> Mutate)[]
        {
            ("stale source", value => value["sourceSha256"] = new string('0', 64)),
            ("unknown field", value => value["actor"] = "not-authority"),
            ("wrong schema", value => value["schemaVersion"] = "1hk-dwg-edits/3"),
            ("wrong coordinates", value => value["coordinateSystem"] = "SCREEN_PIXELS"),
            ("empty edits", value => value["edits"] = new JsonArray()),
            ("missing handle", value => value["edits"]![0]!["handle"] = "FFFFFFFFFFFFFFFE"),
            ("noncanonical handle", value => value["edits"]![0]!["handle"] = "01"),
            ("duplicate handle", value => value["edits"]!.AsArray().Add(value["edits"]![0]!.DeepClone())),
            ("wrong entity type", value => { value["edits"]![1]!["handle"] = value["edits"]![0]!["handle"]!.DeepClone(); value["edits"]!.AsArray().RemoveAt(0); }),
            ("missing point", value => value["edits"]![0]!.AsObject().Remove("start")),
            ("wrong point dimensions", value => value["edits"]![0]!["end"] = JsonNode.Parse("[1,2]")),
            ("unbounded point", value => value["edits"]![0]!["end"] = JsonNode.Parse("[1e300,2,3]")),
            ("degenerate line", value => value["edits"]![0]!["end"] = value["edits"]![0]!["start"]!.DeepClone()),
            ("multiline TEXT", value => value["edits"]![1]!["text"] = "not\nsingle line"),
            ("Unicode line separator", value => value["edits"]![1]!["text"] = "not\u2028single line"),
            ("field expression", value => value["edits"]![1]!["text"] = "%<field>%"),
            ("CAD control sequence", value => value["edits"]![1]!["text"] = "%%uunderlined"),
            ("null text", value => value["edits"]![1]!["text"] = null),
        };
        foreach (var item in cases)
        {
            using var fixture = new Fixture();
            var request = fixture.ValidRequest();
            item.Mutate(request);
            AssertRejected(fixture, request.ToJsonString(), item.Name);
        }
        using (var fixture = new Fixture())
        {
            var raw = fixture.ValidRequest().ToJsonString();
            AssertRejected(fixture, raw.Replace("\"schemaVersion\":", "\"schemaVersion\":\"1hk-dwg-edits/1\",\"schemaVersion\":"), "duplicate JSON field");
        }
        using (var fixture = new Fixture())
        {
            var raw = fixture.ValidRequest().ToJsonString();
            AssertRejected(fixture, raw.Replace("EDITED", "\\uD800"), "malformed Unicode");
        }
        using (var fixture = new Fixture())
        {
            AssertRejected(fixture, new string(' ', 2 * 1024 * 1024 + 1), "oversized request");
        }
        using (var fixture = new Fixture())
        {
            var request = fixture.ValidRequest();
            request["edits"] = new JsonArray(Enumerable.Range(0, 10_001).Select(_ => request["edits"]![0]!.DeepClone()).ToArray());
            AssertRejected(fixture, request.ToJsonString(), "edit count budget");
        }
        using (var fixture = new Fixture())
        {
            var request = fixture.ValidRequest();
            request["edits"]!.AsArray().RemoveAt(1);
            request["edits"]![0]!["handle"] = fixture.BlockLine;
            AssertRejected(fixture, request.ToJsonString(), "block definition is not model-space selection");
        }
        using (var fixture = new Fixture())
        {
            var request = fixture.ValidRequest();
            request["edits"]!.AsArray().RemoveAt(0);
            request["edits"]![0]!["handle"] = fixture.PaperText;
            AssertRejected(fixture, request.ToJsonString(), "paper-space is not model-space selection");
        }
    }

    internal static void ValidatesBatchBeforeMutation()
    {
        using var fixture = new Fixture();
        var request = fixture.ValidRequest();
        request["edits"]![1]!["handle"] = "FFFFFFFFFFFFFFFE";
        File.WriteAllText(fixture.Request, request.ToJsonString());
        using var reader = new DwgReader(fixture.Input);
        var document = reader.Read();
        var rejected = false;
        try { SelectedDwgEdits.Load(fixture.Request).Apply(document, fixture.SourceSha); }
        catch (InvalidDataException) { rejected = true; }
        Equal(true, rejected);
        var selectedLine = document.Entities.OfType<Line>().Last();
        Equal(new XYZ(0, 10, 0), selectedLine.StartPoint);
        Equal(new XYZ(10, 10, 0), selectedLine.EndPoint);
    }

    internal static void DetectsLineNormalChange()
    {
        var document = new CadDocument(ACadVersion.AC1024);
        var line = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
        document.Entities.Add(line);
        var expected = QualificationRunner.Inventory(document, new List<string>());
        line.Normal = new XYZ(0, 1, 0);
        var actual = QualificationRunner.Inventory(document, new List<string>());
        Equal(true, SemanticComparer.Compare(expected, actual, ExpectedEdits.None, 1e-9).Failures.Any());
    }

    internal static void DetectsReferenceChange()
    {
        var baseline = ReferencedInventory(false, false);
        var styleDetected = SemanticComparer.Compare(baseline, ReferencedInventory(true, false), ExpectedEdits.None, 1e-9).Failures.Any();
        var blockDetected = SemanticComparer.Compare(baseline, ReferencedInventory(false, true), ExpectedEdits.None, 1e-9).Failures.Any();
        if (!styleDetected || !blockDetected)
            throw new InvalidOperationException($"Style switch detected={styleDetected}; block switch detected={blockDetected}");

        static CadInventory ReferencedInventory(bool changeStyle, bool changeBlock)
        {
            var document = new CadDocument(ACadVersion.AC1024);
            var firstStyle = new TextStyle("STYLE1");
            var otherStyle = new TextStyle("STYLE01");
            document.TextStyles.Add(firstStyle);
            document.TextStyles.Add(otherStyle);
            var firstBlock = new BlockRecord("PART1");
            var otherBlock = new BlockRecord("PART01");
            document.BlockRecords.Add(firstBlock);
            document.BlockRecords.Add(otherBlock);
            document.Entities.Add(new TextEntity { Value = "TEXT", Height = 3, Style = changeStyle ? otherStyle : firstStyle });
            document.Entities.Add(new Insert(changeBlock ? otherBlock : firstBlock));
            return QualificationRunner.Inventory(document, new List<string>());
        }
    }

    private static void AssertRejected(Fixture fixture, string request, string name)
    {
        File.WriteAllText(fixture.Request, request);
        var code = Program.Main(["qualify", "--input", fixture.Input, "--edits", fixture.Request, "--output-dir", fixture.Output]);
        if (code != 2) throw new InvalidOperationException($"{name}: expected validation exit 2, got {code}");
        Equal(false, File.Exists(Path.Combine(fixture.Output, "edited-roundtrip.dwg")));
        Equal(false, File.Exists(Path.Combine(fixture.Output, "no-edit-roundtrip.dwg")));
        Equal(fixture.SourceSha, Sha(File.ReadAllBytes(fixture.Input)));
    }

    private static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static void Equal<T>(T expected, T actual)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new InvalidOperationException($"Expected {expected}, got {actual}");
    }

    private sealed class Fixture : IDisposable
    {
        private readonly string _root = Path.Combine(Path.GetTempPath(), $"selected-dwg-test-{Guid.NewGuid():N}");
        internal string Input => Path.Combine(_root, "source.dwg");
        internal string Output => Path.Combine(_root, "result");
        internal string Request => Path.Combine(_root, "edits.json");
        internal string SourceSha { get; }
        internal string TargetLine { get; }
        internal string TargetText { get; }
        internal string BlockLine { get; }
        internal string PaperText { get; }

        internal JsonObject ValidRequest() => JsonSerializer.SerializeToNode(new
        {
            schemaVersion = "1hk-dwg-edits/1", sourceSha256 = SourceSha, coordinateSystem = "WCS_NATIVE_UNITS",
            edits = new object[]
            {
                new { handle = TargetLine, type = "LINE", start = new[] { 4d, 5d, 6d }, end = new[] { 24d, 35d, 46d } },
                new { handle = TargetText, type = "TEXT", text = "EDITED" },
            },
        })!.AsObject();

        internal Fixture()
        {
            Directory.CreateDirectory(_root);
            var document = new CadDocument(ACadVersion.AC1024);
            document.Header.InsUnits = UnitsType.Millimeters;
            document.Entities.Add(new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0)));
            var targetLine = new Line(new XYZ(0, 10, 0), new XYZ(10, 10, 0)) { Thickness = 2 };
            document.Entities.Add(targetLine);
            document.Entities.Add(new TextEntity { InsertPoint = new XYZ(0, 20, 0), Height = 3, Value = "DO NOT EDIT" });
            var targetText = new TextEntity { InsertPoint = new XYZ(20, 30, 0), Height = 3, Value = "EDIT ME" };
            document.Entities.Add(targetText);
            var block = new BlockRecord("UNSELECTED_BLOCK");
            var blockLine = new Line(new XYZ(0, 0, 0), new XYZ(5, 0, 0));
            block.Entities.Add(blockLine);
            document.BlockRecords.Add(block);
            var paperText = new TextEntity { InsertPoint = new XYZ(1, 2, 0), Height = 3, Value = "PAPER" };
            document.Layouts.First(layout => layout.IsPaperSpace).AssociatedBlock.Entities.Add(paperText);
            using (var writer = new DwgWriter(Input, document)) writer.Write();
            SourceSha = Sha(File.ReadAllBytes(Input));
            TargetLine = targetLine.Handle.ToString("X");
            TargetText = targetText.Handle.ToString("X");
            BlockLine = blockLine.Handle.ToString("X");
            PaperText = paperText.Handle.ToString("X");
        }

        public void Dispose() => Directory.Delete(_root, recursive: true);
    }
}
