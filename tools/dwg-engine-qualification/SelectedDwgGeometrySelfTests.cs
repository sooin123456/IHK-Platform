using System.Security.Cryptography;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using ACadSharp;
using ACadSharp.Classes;
using ACadSharp.Entities;
using ACadSharp.IO;
using ACadSharp.Objects;
using ACadSharp.Types.Units;
using CSMath;

namespace DwgEngineQualification;

internal static class SelectedDwgGeometrySelfTests
{
    internal static void EditsAllSupportedV2Geometry()
    {
        using var fixture = new Fixture();
        var requestBytes = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = "1hk-dwg-edits/2",
            sourceSha256 = fixture.SourceSha,
            coordinateSystem = "WCS_NATIVE_UNITS",
            edits = new object[]
            {
                new { handle = fixture.Line, type = "LINE", start = new[] { 2d, 4d, 0d }, end = new[] { 10d, 12d, 0d } },
                new { handle = fixture.Polyline, type = "LWPOLYLINE", points = new[] { new[] { 3d, 5d, 0d }, new[] { 7d, 11d, 0d }, new[] { 13d, 5d, 0d } }, closed = true },
                new { handle = fixture.Circle, type = "CIRCLE", center = new[] { 12d, 14d, 0d }, radius = 7d },
                new { handle = fixture.WrappedArc, type = "ARC", center = new[] { 30d, 35d, 0d }, radius = 9d, startAngleRadians = 5.5d, endAngleRadians = 1.25d },
                new { handle = fixture.FullTurnArc, type = "ARC", center = new[] { 50d, 55d, 0d }, radius = 11d, startAngleRadians = 0d, endAngleRadians = Math.PI * 2 },
                new { handle = fixture.Text, type = "TEXT", insert = new[] { 18d, 20d, 0d }, height = 4d, text = "선택 문자 v2" },
            },
        });
        File.WriteAllBytes(fixture.Request, requestBytes);

        Equal(0, Program.Main(["qualify", "--input", fixture.Input, "--output-dir", fixture.Output, "--edits", fixture.Request]));

        using var reader = StrictReader(Path.Combine(fixture.Output, "edited-roundtrip.dwg"));
        var document = reader.Read();
        var line = Exact<Line>(document, fixture.Line);
        Equal(new XYZ(2, 4, 0), line.StartPoint);
        Equal(new XYZ(10, 12, 0), line.EndPoint);
        var polyline = Exact<LwPolyline>(document, fixture.Polyline);
        Equal(true, polyline.IsClosed);
        Equal(true, polyline.Flags.HasFlag(LwPolylineFlags.Plinegen));
        Equal(new XY(3, 5), polyline.Vertices[0].Location);
        Equal(new XY(7, 11), polyline.Vertices[1].Location);
        Equal(new XY(13, 5), polyline.Vertices[2].Location);
        var circle = Exact<Circle>(document, fixture.Circle);
        Equal(new XYZ(12, 14, 0), circle.Center);
        Equal(7d, circle.Radius);
        var wrapped = Exact<Arc>(document, fixture.WrappedArc);
        Equal(new XYZ(30, 35, 0), wrapped.Center);
        Equal(9d, wrapped.Radius);
        Equal(5.5d, wrapped.StartAngle);
        Equal(1.25d, wrapped.EndAngle);
        var fullTurn = Exact<Arc>(document, fixture.FullTurnArc);
        Equal(new XYZ(50, 55, 0), fullTurn.Center);
        Equal(11d, fullTurn.Radius);
        Equal(0d, fullTurn.StartAngle);
        Equal(Math.PI * 2, fullTurn.EndAngle);
        var text = Exact<TextEntity>(document, fixture.Text);
        Equal(new XYZ(18, 20, 0), text.InsertPoint);
        Equal(4d, text.Height);
        Equal("선택 문자 v2", text.Value);

        var untouched = Exact<Line>(document, fixture.UntouchedLine);
        Equal(new XYZ(70, 75, 0), untouched.StartPoint);
        Equal(new XYZ(80, 85, 0), untouched.EndPoint);
        var blockLine = document.BlockRecords.Single(block => block.Name == "UNTOUCHED_BLOCK").Entities.OfType<Line>().Single();
        Equal(fixture.BlockLine, blockLine.Handle.ToString("X"));
        Equal(new XYZ(1, 1, 0), blockLine.StartPoint);
        Equal(new XYZ(5, 1, 0), blockLine.EndPoint);
        Equal(fixture.SourceSha, Sha(File.ReadAllBytes(fixture.Input)));
        Equal(fixture.SourceSha, Sha(File.ReadAllBytes(Path.Combine(fixture.Output, "input-working-copy.dwg"))));
        Equal(Sha(requestBytes), Sha(File.ReadAllBytes(Path.Combine(fixture.Output, "edit-request.json"))));
    }

    internal static void PreservesPolylineVerticesByIndex()
    {
        // Closure-only, movement, growth and shrinkage retain corresponding vertices.
        foreach (var points in new[]
        {
            new[] { new[] { 0d, 10d, 0d }, new[] { 10d, 15d, 0d }, new[] { 20d, 10d, 0d } },
            new[] { new[] { 3d, 5d, 0d }, new[] { 7d, 11d, 0d }, new[] { 13d, 5d, 0d } },
            new[] { new[] { 3d, 5d, 0d }, new[] { 7d, 11d, 0d }, new[] { 13d, 5d, 0d }, new[] { 20d, 8d, 0d } },
            new[] { new[] { 3d, 5d, 0d }, new[] { 7d, 11d, 0d } },
        })
        {
            using var fixture = new Fixture();
            using var sourceReader = StrictReader(fixture.Input);
            var document = sourceReader.Read();
            var polyline = Exact<LwPolyline>(document, fixture.Polyline);
            var originalVertices = polyline.Vertices.ToArray();
            var request = fixture.ValidRequest();
            var edit = request["edits"]![1]!.DeepClone();
            edit["points"] = JsonSerializer.SerializeToNode(points);
            request["edits"] = new JsonArray(edit);
            File.WriteAllText(fixture.Request, request.ToJsonString());
            SelectedDwgEdits.Load(fixture.Request).Apply(document, fixture.SourceSha);
            Equal(points.Length, polyline.Vertices.Count);
            Equal(true, polyline.IsClosed);
            Equal(true, polyline.Flags.HasFlag(LwPolylineFlags.Plinegen));
            Equal(0, polyline.Vertices[0].Id);
            Equal(0, polyline.Vertices[1].Id);
            if (points.Length >= 3) Equal(0, polyline.Vertices[2].Id);
            if (points.Length == 4) Equal(0, polyline.Vertices[3].Id);
            for (var index = 0; index < points.Length; index++)
            {
                Equal(new XY(points[index][0], points[index][1]), polyline.Vertices[index].Location);
                if (index < originalVertices.Length) Equal(true, ReferenceEquals(originalVertices[index], polyline.Vertices[index]));
            }
            Equal(fixture.SourceSha, Sha(File.ReadAllBytes(fixture.Input)));
        }
    }

    internal static void RejectsInvalidV2PayloadsAndTargets()
    {
        var cases = new (string Name, Action<JsonObject> Mutate)[]
        {
            ("unknown root field", value => value["authority"] = "not-authority"),
            ("missing LINE field", value => value["edits"]![0]!.AsObject().Remove("start")),
            ("nonplanar LINE point", value => value["edits"]![0]!["start"] = JsonNode.Parse("[1,2,1]")),
            ("zero CIRCLE radius", value => value["edits"]![2]!["radius"] = 0),
            ("zero TEXT height", value => value["edits"]![5]!["height"] = 0),
            ("empty TEXT", value => value["edits"]![5]!["text"] = ""),
            ("multiline TEXT", value => value["edits"]![5]!["text"] = "not\nsingle line"),
            ("TEXT line separator", value => value["edits"]![5]!["text"] = "not\u2028single line"),
            ("TEXT CAD control", value => value["edits"]![5]!["text"] = "%%uunderlined"),
            ("TEXT field expression", value => value["edits"]![5]!["text"] = "%<field>%"),
            ("empty ARC", value => value["edits"]![3]!["endAngleRadians"] = value["edits"]![3]!["startAngleRadians"]!.DeepClone()),
            ("ARC over full turn", value => value["edits"]![3]!["endAngleRadians"] = 12),
            ("unbounded radius", value => value["edits"]![2]!["radius"] = 1e300),
            ("one-point polyline", value => value["edits"]![1]!["points"] = JsonNode.Parse("[[0,0,0]]")),
            ("coincident polyline", value => value["edits"]![1]!["points"] = JsonNode.Parse("[[0,0,0],[0,0,0]]")),
            ("non-boolean closed", value => value["edits"]![1]!["closed"] = 1),
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
            var request = fixture.ValidRequest();
            request["edits"]![0]!["handle"] = fixture.NonplanarLine;
            AssertRejected(fixture, request.ToJsonString(), "nonplanar target");
        }
        using (var fixture = new Fixture())
        {
            var request = fixture.ValidRequest();
            request["edits"]![1]!["handle"] = fixture.BulgedPolyline;
            AssertRejected(fixture, request.ToJsonString(), "bulged target");
        }
        using (var fixture = new Fixture())
        {
            var request = fixture.ValidRequest();
            request["edits"]![5]!["handle"] = fixture.AlignedText;
            AssertRejected(fixture, request.ToJsonString(), "aligned target");
        }
        using (var fixture = new Fixture())
        {
            var request = fixture.ValidRequest();
            var edit = request["edits"]![2]!.DeepClone();
            edit["handle"] = fixture.WrappedArc;
            request["edits"] = new JsonArray(edit);
            AssertRejected(fixture, request.ToJsonString(), "ARC targeted as CIRCLE");
        }
        using (var fixture = new Fixture())
        {
            var request = fixture.ValidRequest();
            var edit = request["edits"]![3]!.DeepClone();
            edit["handle"] = fixture.Circle;
            request["edits"] = new JsonArray(edit);
            AssertRejected(fixture, request.ToJsonString(), "CIRCLE targeted as ARC");
        }
        using (var fixture = new Fixture())
        {
            var request = fixture.ValidRequest();
            request["edits"] = new JsonArray(
                request["edits"]![0]!.DeepClone(),
                JsonSerializer.SerializeToNode(new
                {
                    handle = fixture.AlignedText,
                    type = "TEXT",
                    insert = new[] { 18d, 20d, 0d },
                    height = 4d,
                    text = "LATE INVALID",
                }));
            File.WriteAllText(fixture.Request, request.ToJsonString());
            using var reader = StrictReader(fixture.Input);
            var document = reader.Read();
            ThrowsContaining(
                () => SelectedDwgEdits.Load(fixture.Request).Apply(document, fixture.SourceSha),
                "supported reader geometry",
                "late invalid target");
            Equal(new XYZ(0, 0, 0), Exact<Line>(document, fixture.Line).StartPoint);
            Equal(new XYZ(10, 0, 0), Exact<Line>(document, fixture.Line).EndPoint);
            AssertRejected(fixture, request.ToJsonString(), "late invalid target command");
        }
    }

    internal static void RejectsV2BudgetsAndMalformedText()
    {
        using (var fixture = new Fixture())
        {
            AssertRejected(fixture, "{\"schemaVersion\":\"1hk-dwg-edits/2\"", "malformed JSON");
        }
        using (var fixture = new Fixture())
        {
            var request = fixture.ValidRequest();
            request["edits"]![5]!["text"] = "EDITED";
            AssertRejected(fixture, request.ToJsonString().Replace("EDITED", "\\uD800", StringComparison.Ordinal), "malformed Unicode");
        }
        using (var fixture = new Fixture())
        {
            var request = fixture.ValidRequest();
            request["edits"]![5]!["text"] = new string('x', 10_001);
            AssertRejected(fixture, request.ToJsonString(), "TEXT length budget");
        }
        using (var fixture = new Fixture())
        {
            AssertRejected(fixture, new string(' ', 2 * 1024 * 1024 + 1), "request byte budget");
        }
        using (var fixture = new Fixture())
        {
            var first = Enumerable.Range(0, 50_001).Select(index => new[] { (double)(index & 1), 0d, 0d }).ToArray();
            var second = Enumerable.Range(0, 50_001).Select(index => new[] { (double)(index & 1), 1d, 0d }).ToArray();
            var request = JsonSerializer.Serialize(new
            {
                schemaVersion = "1hk-dwg-edits/2",
                sourceSha256 = fixture.SourceSha,
                coordinateSystem = "WCS_NATIVE_UNITS",
                edits = new object[]
                {
                    new { handle = fixture.Polyline, type = "LWPOLYLINE", points = first, closed = false },
                    new { handle = fixture.BulgedPolyline, type = "LWPOLYLINE", points = second, closed = false },
                },
            });
            AssertRejected(fixture, request, "aggregate polyline point budget");
        }
    }

    internal static void RejectsRetainedUnknownObjectsBeforeMutation()
    {
        foreach (var addUnknown in new Action<CadDocument>[]
        {
            document => document.Entities.Add(Unknown<UnknownEntity>(isEntity: true)),
            document => document.RootDictionary.Add("QA_UNKNOWN", Unknown<UnknownNonGraphicalObject>(isEntity: false)),
            document => document.Entities.First().CreateExtendedDictionary().Add("QA_UNKNOWN", Unknown<UnknownNonGraphicalObject>(isEntity: false)),
            document => document.Entities.Last().CreateExtendedDictionary().Add("QA_UNKNOWN", Unknown<UnknownNonGraphicalObject>(isEntity: false)),
            document => document.Layers.First().CreateExtendedDictionary().Add("QA_UNKNOWN", Unknown<UnknownNonGraphicalObject>(isEntity: false)),
            document => document.BlockRecords.First().CreateExtendedDictionary().Add("QA_UNKNOWN", Unknown<UnknownNonGraphicalObject>(isEntity: false)),
            document => document.RootDictionary.CreateExtendedDictionary().CreateExtendedDictionary().Add("QA_UNKNOWN", Unknown<UnknownNonGraphicalObject>(isEntity: false)),
            document =>
            {
                var first = document.Entities.First();
                var last = document.Entities.Last();
                first.AddReactor(last);
                last.AddReactor(first);
                last.CreateExtendedDictionary().Add("QA_UNKNOWN", Unknown<UnknownNonGraphicalObject>(isEntity: false));
            },
        })
        {
            using var fixture = new Fixture();
            using var reader = StrictReader(fixture.Input);
            var document = reader.Read();
            addUnknown(document);
            var request = fixture.ValidRequest();
            request["edits"] = new JsonArray(request["edits"]![0]!.DeepClone());
            File.WriteAllText(fixture.Request, request.ToJsonString());

            ThrowsContaining(
                () => SelectedDwgEdits.Load(fixture.Request).Apply(document, fixture.SourceSha),
                "unknown",
                "retained unknown object");
            Equal(new XYZ(0, 0, 0), Exact<Line>(document, fixture.Line).StartPoint);
            Equal(new XYZ(10, 0, 0), Exact<Line>(document, fixture.Line).EndPoint);
            Equal(fixture.SourceSha, Sha(File.ReadAllBytes(fixture.Input)));
            Equal(false, File.Exists(Path.Combine(fixture.Output, "no-edit-roundtrip.dwg")));
            Equal(false, File.Exists(Path.Combine(fixture.Output, "edited-roundtrip.dwg")));
        }

        // A graph with only known objects must complete even when attachments cycle.
        using var cyclicFixture = new Fixture();
        using var cyclicReader = StrictReader(cyclicFixture.Input);
        var cyclicDocument = cyclicReader.Read();
        var firstKnown = cyclicDocument.Entities.First();
        var lastKnown = cyclicDocument.Entities.Last();
        firstKnown.AddReactor(lastKnown);
        lastKnown.AddReactor(firstKnown);
        QualificationRunner.RejectUnwritableObjects(cyclicDocument);
    }

    internal static void RejectsLossyVertexIdentifiersBeforeMutation()
    {
        // The pinned writer drops IDs: demonstrate the actual binary limitation, then
        // require v2 to reject that retained metadata rather than knowingly discard it.
        using (var fixture = new Fixture())
        {
            using var sourceReader = StrictReader(fixture.Input);
            var source = sourceReader.Read();
            var polyline = Exact<LwPolyline>(source, fixture.Polyline);
            polyline.Vertices[0].Id = 31;
            var probePath = Path.ChangeExtension(fixture.Request, ".dwg");
            using (var writer = new DwgWriter(probePath, source)) writer.Write();
            using var rereader = StrictReader(probePath);
            Equal(0, Exact<LwPolyline>(rereader.Read(), fixture.Polyline).Vertices[0].Id);
            Equal(fixture.SourceSha, Sha(File.ReadAllBytes(fixture.Input)));
        }

        foreach (var location in new[] { "target", "model", "block", "paper" })
        {
            using var fixture = new Fixture();
            using var reader = StrictReader(fixture.Input);
            var document = reader.Read();
            var target = Exact<LwPolyline>(document, fixture.Polyline);
            var retained = location == "target" ? target : new LwPolyline(new[] { new XY(1, 2), new XY(3, 4) });
            retained.Vertices[0].Id = 31;
            switch (location)
            {
                case "model": document.Entities.Add(retained); break;
                case "block": document.BlockRecords.Single(block => block.Name == "UNTOUCHED_BLOCK").Entities.Add(retained); break;
                case "paper": document.PaperSpace.Entities.Add(retained); break;
            }
            Equal(retained, document.GetCadObject(retained.Handle));
            var request = fixture.ValidRequest();
            request["edits"] = new JsonArray(request["edits"]![0]!.DeepClone(), request["edits"]![1]!.DeepClone());
            File.WriteAllText(fixture.Request, request.ToJsonString());
            ThrowsContaining(() => SelectedDwgEdits.Load(fixture.Request).Apply(document, fixture.SourceSha), "vertex", location + " vertex IDs");
            Equal(new XYZ(0, 0, 0), Exact<Line>(document, fixture.Line).StartPoint);
            Equal(new XY(0, 10), target.Vertices[0].Location);
            Equal(false, target.IsClosed);
            Equal(31, retained.Vertices[0].Id);
            Equal(fixture.SourceSha, Sha(File.ReadAllBytes(fixture.Input)));
        }
    }

    internal static void RejectsResultingDocumentPointOverflowBeforeMutation()
    {
        var root = Path.Combine(Path.GetTempPath(), $"selected-dwg-v2-budget-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            var document = new CadDocument(ACadVersion.AC1024);
            var line = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
            var target = new LwPolyline(new[] { new XY(0, 10), new XY(10, 10) });
            var retained = new Polyline2D();
            for (var index = 0; index < 99_998; index++)
                retained.Vertices.Add(new Vertex2D { Location = new XYZ(index % 1000, index / 1000, 0) });
            document.Entities.Add(line);
            document.Entities.Add(target);
            document.Entities.Add(retained);
            var sha = new string('a', 64);
            var requestPath = Path.Combine(root, "edits.json");
            File.WriteAllBytes(requestPath, JsonSerializer.SerializeToUtf8Bytes(new
            {
                schemaVersion = "1hk-dwg-edits/2",
                sourceSha256 = sha,
                coordinateSystem = "WCS_NATIVE_UNITS",
                edits = new object[]
                {
                    new { handle = line.Handle.ToString("X"), type = "LINE", start = new[] { 2d, 4d, 0d }, end = new[] { 10d, 12d, 0d } },
                    new { handle = target.Handle.ToString("X"), type = "LWPOLYLINE", points = new[] { new[] { 0d, 10d, 0d }, new[] { 5d, 15d, 0d }, new[] { 10d, 10d, 0d } }, closed = false },
                },
            }));

            ThrowsContaining(
                () => SelectedDwgEdits.Load(requestPath).Apply(document, sha),
                "point budget",
                "resulting document point overflow");
            Equal(new XYZ(0, 0, 0), line.StartPoint);
            Equal(new XYZ(10, 0, 0), line.EndPoint);
            Equal(2, target.Vertices.Count);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static DwgReader StrictReader(string path)
    {
        var reader = new DwgReader(path);
        reader.Configuration.Failsafe = false;
        reader.Configuration.KeepUnknownEntities = true;
        reader.Configuration.KeepUnknownNonGraphicalObjects = true;
        return reader;
    }

    private static T Unknown<T>(bool isEntity) where T : CadObject
    {
        var dxfClass = new DxfClass
        {
            ClassNumber = 500,
            CppClassName = $"QA_{typeof(T).Name}",
            DwgVersion = ACadVersion.AC1024,
            DxfName = $"QA_{typeof(T).Name.ToUpperInvariant()}",
            IsAnEntity = isEntity,
        };
        return (T)(Activator.CreateInstance(
            typeof(T),
            BindingFlags.Instance | BindingFlags.NonPublic,
            binder: null,
            args: [dxfClass],
            culture: null) ?? throw new InvalidOperationException($"Could not create {typeof(T).Name}"));
    }

    private static T Exact<T>(CadDocument document, string handle) where T : Entity =>
        document.Entities.Single(entity => entity.Handle.ToString("X") == handle && entity.GetType() == typeof(T)) as T
        ?? throw new InvalidOperationException($"Expected exact {typeof(T).Name} handle {handle}");

    private static void AssertRejected(Fixture fixture, string request, string name)
    {
        File.WriteAllText(fixture.Request, request);
        var code = Program.Main(["qualify", "--input", fixture.Input, "--edits", fixture.Request, "--output-dir", fixture.Output]);
        if (code != 2) throw new InvalidOperationException($"{name}: expected validation exit 2, got {code}");
        Equal(false, File.Exists(Path.Combine(fixture.Output, "edited-roundtrip.dwg")));
        Equal(false, File.Exists(Path.Combine(fixture.Output, "no-edit-roundtrip.dwg")));
        Equal(fixture.SourceSha, Sha(File.ReadAllBytes(fixture.Input)));
    }

    private static void ThrowsContaining(Action action, string expected, string name)
    {
        try { action(); }
        catch (InvalidDataException exception) when (exception.Message.Contains(expected, StringComparison.OrdinalIgnoreCase)) { return; }
        catch (Exception exception) { throw new InvalidOperationException($"{name}: unexpected {exception.GetType().Name}: {exception.Message}"); }
        throw new InvalidOperationException($"{name}: expected rejection containing '{expected}'");
    }

    private static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static void Equal<T>(T expected, T actual)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new InvalidOperationException($"Expected {expected}, got {actual}");
    }

    private sealed class Fixture : IDisposable
    {
        private readonly string _root = Path.Combine(Path.GetTempPath(), $"selected-dwg-v2-test-{Guid.NewGuid():N}");
        internal string Input => Path.Combine(_root, "source.dwg");
        internal string Output => Path.Combine(_root, "result");
        internal string Request => Path.Combine(_root, "edits.json");
        internal string SourceSha { get; }
        internal string Line { get; }
        internal string Polyline { get; }
        internal string Circle { get; }
        internal string WrappedArc { get; }
        internal string FullTurnArc { get; }
        internal string Text { get; }
        internal string UntouchedLine { get; }
        internal string BlockLine { get; }
        internal string NonplanarLine { get; }
        internal string BulgedPolyline { get; }
        internal string AlignedText { get; }

        internal JsonObject ValidRequest() => JsonSerializer.SerializeToNode(new
        {
            schemaVersion = "1hk-dwg-edits/2",
            sourceSha256 = SourceSha,
            coordinateSystem = "WCS_NATIVE_UNITS",
            edits = new object[]
            {
                new { handle = Line, type = "LINE", start = new[] { 2d, 4d, 0d }, end = new[] { 10d, 12d, 0d } },
                new { handle = Polyline, type = "LWPOLYLINE", points = new[] { new[] { 3d, 5d, 0d }, new[] { 7d, 11d, 0d }, new[] { 13d, 5d, 0d } }, closed = true },
                new { handle = Circle, type = "CIRCLE", center = new[] { 12d, 14d, 0d }, radius = 7d },
                new { handle = WrappedArc, type = "ARC", center = new[] { 30d, 35d, 0d }, radius = 9d, startAngleRadians = 5.5d, endAngleRadians = 1.25d },
                new { handle = FullTurnArc, type = "ARC", center = new[] { 50d, 55d, 0d }, radius = 11d, startAngleRadians = 0d, endAngleRadians = Math.PI * 2 },
                new { handle = Text, type = "TEXT", insert = new[] { 18d, 20d, 0d }, height = 4d, text = "선택 문자 v2" },
            },
        })!.AsObject();

        internal Fixture()
        {
            Directory.CreateDirectory(_root);
            var document = new CadDocument(ACadVersion.AC1024);
            document.Header.InsUnits = UnitsType.Millimeters;

            var line = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
            var polyline = new LwPolyline(new[] { new XY(0, 10), new XY(10, 15), new XY(20, 10) })
            {
                Flags = LwPolylineFlags.Plinegen,
            };
            var circle = new Circle(new XYZ(20, 20, 0), 5);
            var wrappedArc = new Arc(new XYZ(30, 30, 0), 6, 5, 1);
            var fullTurnArc = new Arc(new XYZ(50, 50, 0), 8, 0, Math.PI * 2);
            var text = new TextEntity { InsertPoint = new XYZ(10, 20, 0), Height = 3, Value = "EDIT ME" };
            var untouchedLine = new Line(new XYZ(70, 75, 0), new XYZ(80, 85, 0));
            var nonplanarLine = new Line(new XYZ(0, 0, 1), new XYZ(10, 0, 1));
            var bulgedPolyline = new LwPolyline(new[] { new XY(0, 30), new XY(10, 30) });
            bulgedPolyline.Vertices[0].Bulge = 1;
            var alignedText = new TextEntity
            {
                InsertPoint = new XYZ(10, 40, 0),
                AlignmentPoint = new XYZ(15, 40, 0),
                HorizontalAlignment = TextHorizontalAlignment.Center,
                Height = 3,
                Value = "ALIGNED",
            };
            document.Entities.Add(line);
            document.Entities.Add(polyline);
            document.Entities.Add(circle);
            document.Entities.Add(wrappedArc);
            document.Entities.Add(fullTurnArc);
            document.Entities.Add(text);
            document.Entities.Add(untouchedLine);
            document.Entities.Add(nonplanarLine);
            document.Entities.Add(bulgedPolyline);
            document.Entities.Add(alignedText);

            var block = new ACadSharp.Tables.BlockRecord("UNTOUCHED_BLOCK");
            var blockLine = new Line(new XYZ(1, 1, 0), new XYZ(5, 1, 0));
            block.Entities.Add(blockLine);
            document.BlockRecords.Add(block);

            using (var writer = new DwgWriter(Input, document)) writer.Write();
            SourceSha = Sha(File.ReadAllBytes(Input));
            Line = line.Handle.ToString("X");
            Polyline = polyline.Handle.ToString("X");
            Circle = circle.Handle.ToString("X");
            WrappedArc = wrappedArc.Handle.ToString("X");
            FullTurnArc = fullTurnArc.Handle.ToString("X");
            Text = text.Handle.ToString("X");
            UntouchedLine = untouchedLine.Handle.ToString("X");
            BlockLine = blockLine.Handle.ToString("X");
            NonplanarLine = nonplanarLine.Handle.ToString("X");
            BulgedPolyline = bulgedPolyline.Handle.ToString("X");
            AlignedText = alignedText.Handle.ToString("X");
        }

        public void Dispose() => Directory.Delete(_root, recursive: true);
    }
}
