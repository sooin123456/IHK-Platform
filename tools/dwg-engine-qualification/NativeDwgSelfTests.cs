using System.Text.Json;
using System.Text.Json.Nodes;
using ACadSharp;
using ACadSharp.Entities;
using ACadSharp.IO;
using ACadSharp.Types.Units;
using CSMath;

namespace DwgEngineQualification;

internal static class NativeDwgSelfTests
{
    public static int Run(string inputDirectory, TextWriter output)
    {
        var tests = new (string Name, Action Body)[]
        {
            ("writes measured manifest as readable native DWG", () => WritesMeasuredManifest(inputDirectory)),
            ("writes all four canonical manifests", () => WritesAllCanonicalManifests(inputDirectory)),
            ("preserves literal edge geometry and styles", () => PreservesLiteralEdges(inputDirectory)),
            ("normalizes large finite rotations before radians", () => PreservesLargeFiniteRotations(inputDirectory)),
            ("preserves a custom paper profile", () => PreservesCustomPaper(inputDirectory)),
            ("rejects malformed duplicate unknown reference policy profile and oversized inputs", () => RejectsInvalidInputs(inputDirectory)),
            ("rejects unrepresentable referenced block transforms before output", () => RejectsUnrepresentableBlockTransforms(inputDirectory)),
            ("keeps representable large mirrored block transforms", () => KeepsRepresentableLargeBlockTransform(inputDirectory)),
            ("refuses path collisions without overwriting", () => RefusesPathCollisions(inputDirectory)),
            ("detects a corrupted read-back entity", () => DetectsCorruptReadBack(inputDirectory)),
            ("detects constrained native geometry and style mutations", () => DetectsConstrainedMutations(inputDirectory)),
            ("requires the exact pinned notification set", RequiresExactNotifications),
            ("keeps failure reports free of local paths", () => KeepsFailureReportsPathSafe(inputDirectory)),
        };
        var failed = 0;
        foreach (var test in tests)
        {
            try
            {
                test.Body();
                output.WriteLine($"PASS {test.Name}");
            }
            catch (Exception exception)
            {
                failed++;
                output.WriteLine($"FAIL {test.Name}: {exception.Message}");
            }
        }
        output.WriteLine($"{tests.Length - failed} passed, {failed} failed");
        return failed == 0 ? 0 : 1;
    }

    private static void WritesMeasuredManifest(string inputDirectory)
    {
        using var temp = TestDirectory.Create();
        var input = Path.Combine(inputDirectory, "measured-plan.cad.json");
        var outputDirectory = Path.Combine(temp.Path, "output");
        AssertEqual(0, Program.Main(["write-native", "--input", input, "--output-dir", outputDirectory]));
        using var reader = new DwgReader(Path.Combine(outputDirectory, "native.dwg"));
        var actual = reader.Read();
        AssertEqual("AC1024", actual.Header.VersionString);
        AssertEqual(UnitsType.Millimeters, actual.Header.InsUnits);
        AssertEqual(19, actual.Entities.Count());
        var ordinaryBlocks = actual.BlockRecords.Where(block => block.Name.StartsWith("B_", StringComparison.Ordinal)).ToArray();
        AssertEqual(1, ordinaryBlocks.Length);
        AssertEqual(4, ordinaryBlocks[0].Entities.Count());
        var dimensions = actual.Entities.OfType<DimensionAligned>().OrderBy(dimension => dimension.Measurement).ToArray();
        AssertEqual(2, dimensions.Length);
        AssertNear(4000, dimensions[0].Measurement);
        AssertNear(6000, dimensions[1].Measurement);
        foreach (var dimension in dimensions) AssertDimensionChildren(dimension);
        var layout = actual.Layouts.Single(item => item.IsPaperSpace);
        AssertNear(420, layout.PaperWidth);
        AssertNear(297, layout.PaperHeight);
        var viewport = layout.Viewports.Single(item => !item.RepresentsPaper);
        AssertNear(0.02, viewport.Height / viewport.ViewHeight);
        AssertEqual(true, File.ReadAllBytes(input).SequenceEqual(File.ReadAllBytes(Path.Combine(outputDirectory, "source-manifest.json"))));
        var reportText = File.ReadAllText(Path.Combine(outputDirectory, "native-report.json"));
        var report = JsonNode.Parse(reportText)!;
        AssertEqual("experimental-unqualified", report["qualification"]!.GetValue<string>());
        AssertEqual("not-qualified", report["productionDwgDeliveryQualification"]!.GetValue<string>());
        AssertEqual("not-performed", report["independentCadVerification"]!.GetValue<string>());
        AssertEqual("producer-required", report["canonicalSourceValidation"]!.GetValue<string>());
        AssertEqual(false, reportText.Contains(Path.GetFullPath(inputDirectory), StringComparison.Ordinal));
    }

    private static void WritesAllCanonicalManifests(string inputDirectory)
    {
        foreach (var name in new[] { "finishes-takeoff", "measured-plan", "office-layout", "remodel-phases" })
        {
            using var temp = TestDirectory.Create();
            var result = NativeDwgWriter.Run(Path.Combine(inputDirectory, $"{name}.cad.json"), Path.Combine(temp.Path, "output"), new StringWriter(), new StringWriter());
            AssertEqual(0, result);
            using var reader = new DwgReader(Path.Combine(temp.Path, "output", "native.dwg"));
            AssertEqual("AC1024", reader.Read().Header.VersionString);
        }
    }

    private static void PreservesLiteralEdges(string inputDirectory)
    {
        using var temp = TestDirectory.Create();
        var input = Path.Combine(temp.Path, "edge.cad.json");
        var root = LoadNode(inputDirectory);
        var entities = root["entities"]!.AsArray();
        var lineIndexes = Indexes(entities, "line");
        entities[lineIndexes[0]]!["geometry"] = JsonNode.Parse("""{"type":"circle","center":{"x":9000,"y":-9000},"radius":125}""");
        entities[lineIndexes[1]]!["geometry"] = JsonNode.Parse("""{"type":"arc","center":{"x":9500,"y":-9000},"radius":250,"startAngleDegrees":10,"endAngleDegrees":370}""");
        var hatch = entities.First(entity => entity!["geometry"]!["type"]!.GetValue<string>() == "hatch")!;
        hatch["geometry"] = JsonNode.Parse("""{"type":"hatch","boundary":{"type":"circle","center":{"x":10000,"y":-9000},"radius":180},"color":"#112233","opacity":0.5019607843137255}""");
        hatch["style"]!["fill"] = "#11223380";
        var insert = entities.First(entity => entity!["geometry"]!["type"]!.GetValue<string>() == "insert")!["geometry"]!;
        insert["scaleX"] = -1.5;
        insert["scaleY"] = 0.75;
        insert["rotationDegrees"] = -40;
        var text = entities.First(entity => entity!["geometry"]!["type"]!.GetValue<string>() == "text")!["geometry"]!;
        text["text"] = "한글 \\ {중괄호}\n둘째 줄 100%";
        text["rotationDegrees"] = -30;
        var dimension = entities.First(entity => entity!["geometry"]!["type"]!.GetValue<string>() == "dimension")!["geometry"]!;
        dimension["start"] = JsonNode.Parse("""{"x":0,"y":0}""");
        dimension["end"] = JsonNode.Parse("""{"x":3000,"y":-4000}""");
        dimension["dimensionLinePoint"] = JsonNode.Parse("""{"x":2200,"y":-4600}""");
        dimension["textPosition"] = JsonNode.Parse("""{"x":700,"y":-2300}""");
        dimension["measurementMillimeters"] = 5000;
        var layer = root["layers"]![0]!;
        layer["visible"] = false;
        layer["locked"] = true;
        var layerId = layer["id"]!.GetValue<string>();
        var sourceLayer = root["metadata"]!["structure"]!["layers"]![layerId]!;
        sourceLayer["visible"] = false;
        sourceLayer["locked"] = true;
        WriteNode(input, root);

        var outputDirectory = Path.Combine(temp.Path, "output");
        AssertEqual(0, NativeDwgWriter.Run(input, outputDirectory, new StringWriter(), new StringWriter()));
        using var reader = new DwgReader(Path.Combine(outputDirectory, "native.dwg"));
        var actual = reader.Read();
        AssertEqual(1, actual.Entities.OfType<Circle>().Count(circle => circle is not Arc));
        var arc = actual.Entities.OfType<Arc>().Single();
        AssertNear(MathHelper.TwoPI, arc.EndAngle - arc.StartAngle, 1e-10);
        var actualHatch = actual.Entities.OfType<Hatch>().First(item => item.Paths[0].Edges[0] is Hatch.BoundaryPath.Arc);
        AssertEqual(49, actualHatch.Transparency.Value);
        var actualInsert = actual.Entities.OfType<Insert>().Single();
        AssertNear(-1.5, actualInsert.XScale);
        AssertNear(0.75, actualInsert.YScale);
        var actualText = actual.Entities.OfType<MText>().First(item => item.PlainText.StartsWith("한글", StringComparison.Ordinal));
        AssertEqual("한글 \\ {중괄호}\n둘째 줄 100%", actualText.PlainText);
        AssertNear(-Math.PI / 6, actualText.Rotation, 1e-10);
        AssertNear(0.72, actualText.LineSpacing, 1e-12);
        AssertNear(168, actualText.Height * actualText.LineSpacing * 5 / 3, 1e-7);
        var actualLayer = actual.Layers.Single(item => item.Name == layer["cadName"]!.GetValue<string>());
        AssertEqual(false, actualLayer.IsOn);
        AssertEqual(true, actualLayer.Flags.HasFlag(ACadSharp.Tables.LayerFlags.Locked));
        AssertDimensionChildren(actual.Entities.OfType<DimensionAligned>().Single(item => Math.Abs(item.Measurement - 5000) < 1e-7));
    }

    private static void PreservesCustomPaper(string inputDirectory)
    {
        using var temp = TestDirectory.Create();
        var input = Path.Combine(temp.Path, "custom.cad.json");
        var root = LoadNode(inputDirectory);
        var profile = JsonNode.Parse("""{"paper":"CUSTOM_210X148_5","orientation":"landscape","widthMillimeters":210,"heightMillimeters":148.5,"scaleDenominator":100}""")!;
        root["canvas"]!["outputProfile"] = profile.DeepClone();
        root["canvas"]!["viewport"]!["paperCenter"] = JsonNode.Parse("""{"x":105,"y":74.25}""");
        root["canvas"]!["viewport"]!["scale"] = 0.01;
        var canvasId = root["canvas"]!["id"]!.GetValue<string>();
        root["metadata"]!["structure"]!["canvases"]![canvasId]!["outputProfile"] = profile.DeepClone();
        foreach (var entity in root["entities"]!.AsArray().Concat(root["blocks"]!.AsArray().SelectMany(block => block!["entities"]!.AsArray())))
            if (entity!["style"]!["kind"]!.GetValue<string>() == "resolved") entity["style"]!["requestedPaperLineweightMillimeters"] = entity["style"]!["strokeWidth"]!.GetValue<double>() / 100;
        WriteNode(input, root);
        var outputDirectory = Path.Combine(temp.Path, "output");
        var messages = new StringWriter();
        var errors = new StringWriter();
        var status = NativeDwgWriter.Run(input, outputDirectory, messages, errors);
        if (status != 0) throw new InvalidOperationException($"Expected 0, got {status}: {errors} {messages} {File.ReadAllText(Path.Combine(outputDirectory, "native-report.json"))}");
        using var reader = new DwgReader(Path.Combine(outputDirectory, "native.dwg"));
        var layout = reader.Read().Layouts.Single(item => item.IsPaperSpace);
        AssertNear(210, layout.PaperWidth);
        AssertNear(148.5, layout.PaperHeight);
        AssertNear(0.01, layout.Viewports.Single(item => !item.RepresentsPaper).Height / 14850);
    }

    private static void PreservesLargeFiniteRotations(string inputDirectory)
    {
        using var temp = TestDirectory.Create();
        var input = Path.Combine(temp.Path, "rotations.cad.json");
        var root = LoadNode(inputDirectory);
        root["entities"]!.AsArray().First(entity => entity!["geometry"]!["type"]!.GetValue<string>() == "text")!["geometry"]!["rotationDegrees"] = 1e308;
        root["entities"]!.AsArray().First(entity => entity!["geometry"]!["type"]!.GetValue<string>() == "insert")!["geometry"]!["rotationDegrees"] = -1e308;
        WriteNode(input, root);
        var output = Path.Combine(temp.Path, "output");
        AssertEqual(0, NativeDwgWriter.Run(input, output, new StringWriter(), new StringWriter()));
        using var reader = new DwgReader(Path.Combine(output, "native.dwg"));
        var actual = reader.Read();
        AssertAngle((1e308 % 360) * Math.PI / 180, actual.Entities.OfType<MText>().First().Rotation);
        AssertAngle((-1e308 % 360) * Math.PI / 180, actual.Entities.OfType<Insert>().First().Rotation);
    }

    private static void RejectsInvalidInputs(string inputDirectory)
    {
        using var temp = TestDirectory.Create();
        var source = File.ReadAllText(Path.Combine(inputDirectory, "measured-plan.cad.json"));
        AssertRejected(Path.Combine(temp.Path, "duplicate.json"), "{\"schemaVersion\":\"duplicate\"," + source[1..], temp.Path);
        var unknown = LoadNode(inputDirectory); unknown["unknown"] = true; AssertRejected(Path.Combine(temp.Path, "unknown.json"), unknown.ToJsonString(), temp.Path);
        var dangling = LoadNode(inputDirectory); dangling["entities"]![0]!["layerId"] = "ffffffff-ffff-4fff-8fff-ffffffffffff"; AssertRejected(Path.Combine(temp.Path, "dangling.json"), dangling.ToJsonString(), temp.Path);
        var multiply = LoadNode(inputDirectory); var mappedId = multiply["lineage"]![0]!["entityIds"]![0]!.GetValue<string>(); multiply["lineage"]![1]!["entityIds"]!.AsArray().Add(mappedId); AssertRejected(Path.Combine(temp.Path, "multiply.json"), multiply.ToJsonString(), temp.Path);
        var policy = LoadNode(inputDirectory); policy["policies"]!["fontStatus"] = "verified"; AssertRejected(Path.Combine(temp.Path, "policy.json"), policy.ToJsonString(), temp.Path);
        var profile = LoadNode(inputDirectory); profile["canvas"]!["viewport"]!["scale"] = 0.5; AssertRejected(Path.Combine(temp.Path, "profile.json"), profile.ToJsonString(), temp.Path);
        var control = LoadNode(inputDirectory); control["entities"]!.AsArray().First(entity => entity!["geometry"]!["type"]!.GetValue<string>() == "text")!["geometry"]!["text"] = "unsafe %%d"; AssertRejected(Path.Combine(temp.Path, "control.json"), control.ToJsonString(), temp.Path);
        var zeroAlpha = LoadNode(inputDirectory); zeroAlpha["entities"]!.AsArray().First(entity => entity!["geometry"]!["type"]!.GetValue<string>() == "hatch")!["geometry"]!["opacity"] = 0; AssertRejected(Path.Combine(temp.Path, "alpha.json"), zeroAlpha.ToJsonString(), temp.Path);
        var tinyAlpha = LoadNode(inputDirectory); tinyAlpha["entities"]!.AsArray().First(entity => entity!["geometry"]!["type"]!.GetValue<string>() == "hatch")!["geometry"]!["opacity"] = 0.00001; AssertRejected(Path.Combine(temp.Path, "tiny-alpha.json"), tinyAlpha.ToJsonString(), temp.Path);
        var infiniteBaseline = LoadNode(inputDirectory); infiniteBaseline["entities"]!.AsArray().First(entity => entity!["geometry"]!["type"]!.GetValue<string>() == "text")!["geometry"]!["fontSize"] = 1.7e308; AssertRejected(Path.Combine(temp.Path, "infinite-baseline.json"), infiniteBaseline.ToJsonString(), temp.Path);
        var narrowSpacing = LoadNode(inputDirectory); narrowSpacing["entities"]!.AsArray().First(entity => entity!["geometry"]!["type"]!.GetValue<string>() == "text")!["geometry"]!["lineHeight"] = 0.4; AssertRejected(Path.Combine(temp.Path, "narrow-spacing.json"), narrowSpacing.ToJsonString(), temp.Path);
        var nullRepresentation = LoadNode(inputDirectory); nullRepresentation["lineage"]![0]!["representation"] = null; AssertRejected(Path.Combine(temp.Path, "null-representation.json"), nullRepresentation.ToJsonString(), temp.Path);
        var oversized = Path.Combine(temp.Path, "oversized.json");
        File.WriteAllText(oversized, new string(' ', 20 * 1024 * 1024 + 1));
        AssertEqual(2, NativeDwgWriter.Run(oversized, Path.Combine(temp.Path, "oversized-output"), new StringWriter(), new StringWriter()));
        var malformedUtf8 = Path.Combine(temp.Path, "malformed-utf8.json");
        File.WriteAllBytes(malformedUtf8, [0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]);
        AssertEqual(2, NativeDwgWriter.Run(malformedUtf8, Path.Combine(temp.Path, "malformed-utf8-output"), new StringWriter(), new StringWriter()));
    }

    private static void RefusesPathCollisions(string inputDirectory)
    {
        using var temp = TestDirectory.Create();
        var input = Path.Combine(inputDirectory, "measured-plan.cad.json");
        var output = Path.Combine(temp.Path, "existing");
        Directory.CreateDirectory(output);
        var sentinel = Path.Combine(output, "sentinel.txt");
        File.WriteAllText(sentinel, "preserve");
        AssertEqual(2, NativeDwgWriter.Run(input, output, new StringWriter(), new StringWriter()));
        AssertEqual("preserve", File.ReadAllText(sentinel));
        var insideInput = Path.Combine(output, "inside.json");
        File.Copy(input, insideInput);
        AssertEqual(2, NativeDwgWriter.Run(insideInput, output, new StringWriter(), new StringWriter()));
        AssertEqual(true, File.ReadAllBytes(input).SequenceEqual(File.ReadAllBytes(insideInput)));
    }

    private static void RejectsUnrepresentableBlockTransforms(string inputDirectory)
    {
        using var temp = TestDirectory.Create();
        var multiplication = LoadNode(inputDirectory);
        multiplication["entities"]!.AsArray().First(entity => entity!["geometry"]!["type"]!.GetValue<string>() == "insert")!["geometry"]!["scaleX"] = 1e308;
        AssertRejected(Path.Combine(temp.Path, "insert-multiplication.json"), multiplication.ToJsonString(), temp.Path);

        var translation = LoadNode(inputDirectory);
        translation["entities"]!.AsArray().First(entity => entity!["geometry"]!["type"]!.GetValue<string>() == "insert")!["geometry"]!["origin"] = JsonNode.Parse("""{"x":999999999500,"y":0}""");
        AssertRejected(Path.Combine(temp.Path, "insert-translation.json"), translation.ToJsonString(), temp.Path);

        var curve = LoadNode(inputDirectory);
        curve["blocks"]![0]!["entities"]![0]!["geometry"] = JsonNode.Parse("""{"type":"circle","center":{"x":0,"y":0},"radius":999999999999}""");
        AssertRejected(Path.Combine(temp.Path, "insert-curve-extent.json"), curve.ToJsonString(), temp.Path);
    }

    private static void KeepsRepresentableLargeBlockTransform(string inputDirectory)
    {
        using var temp = TestDirectory.Create();
        var root = LoadNode(inputDirectory);
        var insert = root["entities"]!.AsArray().First(entity => entity!["geometry"]!["type"]!.GetValue<string>() == "insert")!["geometry"]!;
        insert["scaleX"] = -100_000_000;
        insert["scaleY"] = 100_000_000;
        insert["rotationDegrees"] = 30;
        var input = Path.Combine(temp.Path, "large-mirror.json");
        WriteNode(input, root);
        AssertEqual(0, NativeDwgWriter.Run(input, Path.Combine(temp.Path, "output"), new StringWriter(), new StringWriter()));
    }

    private static void DetectsCorruptReadBack(string inputDirectory)
    {
        using var temp = TestDirectory.Create();
        using var manifest = NativeCadManifest.Load(Path.Combine(inputDirectory, "measured-plan.cad.json"));
        var build = NativeDwgWriter.BuildDocument(manifest);
        var path = Path.Combine(temp.Path, "readback.dwg");
        using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        using (var writer = new DwgWriter(stream, build.Document)) writer.Write();
        CadDocument actual;
        using (var reader = new DwgReader(path)) actual = reader.Read();
        var line = actual.Entities.OfType<Line>().First();
        line.EndPoint = new XYZ(line.EndPoint.X + 1, line.EndPoint.Y, line.EndPoint.Z);
        var result = NativeDwgVerification.Compare(
            manifest,
            actual,
            build.Entities.ToDictionary(pair => pair.Key, pair => NativeDwgWriter.Handle(pair.Value.Handle), StringComparer.Ordinal),
            build.Blocks.ToDictionary(pair => pair.Key, pair => NativeDwgWriter.Handle(pair.Value.Handle), StringComparer.Ordinal),
            build.DimensionChildren.ToDictionary(pair => pair.Key, pair => (IReadOnlyList<string>)pair.Value.Select(child => NativeDwgWriter.Handle(child.Handle)).ToArray(), StringComparer.Ordinal));
        AssertContains(result.Failures, "line end changed");
    }

    private static void DetectsConstrainedMutations(string inputDirectory)
    {
        using var temp = TestDirectory.Create();
        using var manifest = NativeCadManifest.Load(Path.Combine(inputDirectory, "measured-plan.cad.json"));
        var build = NativeDwgWriter.BuildDocument(manifest);
        var path = Path.Combine(temp.Path, "readback.dwg");
        using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        using (var writer = new DwgWriter(stream, build.Document)) writer.Write();
        var entityHandles = build.Entities.ToDictionary(pair => pair.Key, pair => NativeDwgWriter.Handle(pair.Value.Handle), StringComparer.Ordinal);
        var blockHandles = build.Blocks.ToDictionary(pair => pair.Key, pair => NativeDwgWriter.Handle(pair.Value.Handle), StringComparer.Ordinal);
        var childHandles = build.DimensionChildren.ToDictionary(pair => pair.Key, pair => (IReadOnlyList<string>)pair.Value.Select(child => NativeDwgWriter.Handle(child.Handle)).ToArray(), StringComparer.Ordinal);

        var mutations = new (string Failure, Action<CadDocument> Mutate)[]
        {
            ("vertex bulge changed", document => document.Entities.OfType<LwPolyline>().First().Vertices[0].Bulge = 0.5),
            ("elevation changed", document => document.Entities.OfType<LwPolyline>().First().Elevation = 2),
            ("constant width changed", document => document.Entities.OfType<LwPolyline>().First().ConstantWidth = 3),
            ("vertex width changed", document => document.Entities.OfType<LwPolyline>().First().Vertices[0].StartWidth = 4),
            ("vertex width changed", document => document.Entities.OfType<LwPolyline>().First().Vertices[0].EndWidth = 4),
            ("normal changed", document => document.Entities.OfType<LwPolyline>().First().Normal = XYZ.AxisY),
            ("thickness changed", document => document.Entities.OfType<LwPolyline>().First().Thickness = 5),
            ("normal changed", document => document.Entities.OfType<Line>().First().Normal = XYZ.AxisY),
            ("thickness changed", document => document.Entities.OfType<Line>().First().Thickness = 5),
            ("common rendering state changed", document => document.Entities.OfType<Line>().First().IsInvisible = true),
            ("common rendering state changed", document => document.Entities.OfType<Line>().First().LineTypeScale = 2),
            ("common rendering state changed", document => document.Entities.OfType<Line>().First().LineType = document.LineTypes.First(lineType => lineType.Name == "Continuous")),
            ("RGB color changed", document => document.Entities.OfType<Line>().First().Color = Color.ByLayer),
            ("solid/associative/path/normal semantics changed", document => document.Entities.OfType<Hatch>().First().Elevation = 2),
            ("solid/associative/path/normal semantics changed", document => document.Entities.OfType<Hatch>().First().Normal = XYZ.AxisY),
            ("insert normal", document => document.Entities.OfType<Insert>().First().Normal = XYZ.AxisY),
            ("array semantics changed", document => document.Entities.OfType<Insert>().First().RowCount = 2),
            ("block-defined rendering style changed", document => document.Entities.OfType<Insert>().First().Color = new Color(1, 2, 3)),
            ("block-defined rendering style changed", document => document.Entities.OfType<Insert>().First().LineWeight = LineWeightType.W211),
            ("block base point changed", document => document.Entities.OfType<Insert>().First().Block.BlockEntity.BasePoint = new XYZ(1, 0, 0)),
            ("dimension text height", document => document.Entities.OfType<DimensionAligned>().First().Style.TextHeight += 1),
            ("style geometry changed", document => document.Entities.OfType<DimensionAligned>().First().Style.ArrowSize += 1),
            ("dimension text color changed", document => document.Entities.OfType<DimensionAligned>().First().Style.TextColor = new Color(1, 2, 3)),
            ("dimension line color changed", document => document.Entities.OfType<DimensionAligned>().First().Style.DimensionLineColor = new Color(1, 2, 3)),
            ("dimension extension line color changed", document => document.Entities.OfType<DimensionAligned>().First().Style.ExtensionLineColor = new Color(1, 2, 3)),
            ("lineweight changed", document => document.Entities.OfType<DimensionAligned>().First().Style.DimensionLineWeight = LineWeightType.W211),
            ("lineweight changed", document => document.Entities.OfType<DimensionAligned>().First().Style.ExtensionLineWeight = LineWeightType.W211),
            ("arrow corner changed", document => document.Entities.OfType<DimensionAligned>().First().Block.Entities.OfType<Solid>().First().SecondCorner += new XYZ(1, 0, 0)),
            ("arrow corner changed", document => document.Entities.OfType<DimensionAligned>().First().Block.Entities.OfType<Solid>().First().ThirdCorner += new XYZ(1, 0, 0)),
            ("arrow corner changed", document => document.Entities.OfType<DimensionAligned>().First().Block.Entities.OfType<Solid>().First().FourthCorner += new XYZ(1, 0, 0)),
            ("child layer changed", document => document.Entities.OfType<DimensionAligned>().First().Block.Entities.OfType<Line>().First().Layer = document.Layers.First(layer => layer.Name != "0")),
            ("child color changed", document => document.Entities.OfType<DimensionAligned>().First().Block.Entities.OfType<Line>().First().Color = new Color(1, 2, 3)),
            ("child lineweight changed", document => document.Entities.OfType<DimensionAligned>().First().Block.Entities.OfType<Line>().First().LineWeight = LineWeightType.W211),
            ("child rendering state changed", document => document.Entities.OfType<DimensionAligned>().First().Block.Entities.OfType<Line>().First().IsInvisible = true),
            ("child rendering state changed", document => document.Entities.OfType<DimensionAligned>().First().Block.Entities.OfType<Line>().First().LineTypeScale = 2),
            ("child rendering state changed", document => document.Entities.OfType<DimensionAligned>().First().Block.Entities.OfType<Line>().First().LineType = document.LineTypes.First(lineType => lineType.Name == "Continuous")),
            ("child owner changed", document => SetOwner(document.Entities.OfType<DimensionAligned>().First().Block.Entities.OfType<Line>().First(), document.ModelSpace)),
        };
        foreach (var mutation in mutations)
        {
            using var reader = new DwgReader(path);
            var actual = reader.Read();
            mutation.Mutate(actual);
            var result = NativeDwgVerification.Compare(manifest, actual, entityHandles, blockHandles, childHandles);
            AssertContains(result.Failures, mutation.Failure);
        }

        using (var reader = new DwgReader(path))
        {
            var result = NativeDwgVerification.Compare(manifest, reader.Read(), entityHandles, blockHandles, new Dictionary<string, IReadOnlyList<string>>());
            AssertContains(result.Failures, "missing expected child handle mapping");
        }
    }

    private static void RequiresExactNotifications()
    {
        const string expected = "ACadSharp.Tables.TextStyle table reference with handle:  | name:  not found for ACadSharp.Objects.TableStyle+CellStyle";
        AssertEqual(true, NativeDwgWriter.NotificationsMatchExpected([], Enumerable.Repeat(expected, 4).ToArray()));
        AssertEqual(false, NativeDwgWriter.NotificationsMatchExpected([], Enumerable.Repeat(expected, 3).ToArray()));
        AssertEqual(false, NativeDwgWriter.NotificationsMatchExpected([], ["TableStyle write corruption"]));
        AssertEqual(false, NativeDwgWriter.NotificationsMatchExpected([expected], Enumerable.Repeat(expected, 4).ToArray()));
    }

    private static void KeepsFailureReportsPathSafe(string inputDirectory)
    {
        using var temp = TestDirectory.Create();
        using var manifest = NativeCadManifest.Load(Path.Combine(inputDirectory, "measured-plan.cad.json"));
        var reportPath = Path.Combine(temp.Path, "native-report.json");
        var privatePath = Path.Combine(temp.Path, "private", "native.dwg");
        NativeDwgWriter.TryWriteFailureReport(reportPath, manifest, [], [], [], new IOException($"Cannot access {privatePath}"));
        var report = File.ReadAllText(reportPath);
        AssertEqual(false, report.Contains(privatePath, StringComparison.Ordinal));
        AssertEqual(false, report.Contains(temp.Path, StringComparison.Ordinal));
        AssertEqual(true, report.Contains("engine-io-failed", StringComparison.Ordinal));
    }

    private static void AssertDimensionChildren(DimensionAligned dimension)
    {
        AssertEqual(4, dimension.Block.Entities.OfType<ACadSharp.Entities.Point>().Count());
        AssertEqual(3, dimension.Block.Entities.OfType<Line>().Count());
        var arrows = dimension.Block.Entities.OfType<Solid>().ToArray();
        AssertEqual(2, arrows.Length);
        var displayEnd = dimension.DefinitionPoint;
        var displayStart = new XYZ(dimension.FirstPoint.X + displayEnd.X - dimension.SecondPoint.X, dimension.FirstPoint.Y + displayEnd.Y - dimension.SecondPoint.Y, 0);
        AssertEqual(true, arrows.Any(arrow => Near(displayStart, arrow.FirstCorner)));
        AssertEqual(true, arrows.Any(arrow => Near(displayEnd, arrow.FirstCorner)));
        var text = dimension.Block.Entities.OfType<MText>().Single();
        AssertEqual(AttachmentPointType.TopLeft, text.AttachmentPoint);
        AssertNear(0, text.Rotation, 1e-10);
        AssertEqual("NotoSansKR-Regular.ttf", text.Style.Filename);
    }

    private static JsonNode LoadNode(string inputDirectory) => JsonNode.Parse(File.ReadAllText(Path.Combine(inputDirectory, "measured-plan.cad.json")))!;
    private static void SetOwner(CadObject value, CadObject owner) => typeof(CadObject).GetProperty(nameof(CadObject.Owner))!.GetSetMethod(true)!.Invoke(value, [owner]);
    private static IReadOnlyList<int> Indexes(JsonArray entities, string type) => entities.Select((entity, index) => (entity, index)).Where(pair => pair.entity!["geometry"]!["type"]!.GetValue<string>() == type).Select(pair => pair.index).ToArray();
    private static void WriteNode(string path, JsonNode node) => File.WriteAllText(path, node.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    private static void AssertRejected(string path, string content, string parent)
    {
        File.WriteAllText(path, content);
        var output = Path.Combine(parent, $"rejected-{Guid.NewGuid():N}");
        AssertEqual(2, NativeDwgWriter.Run(path, output, new StringWriter(), new StringWriter()));
        AssertEqual(false, Directory.Exists(output));
    }
    private static bool Near(XYZ expected, XYZ actual) => Math.Abs(expected.X - actual.X) <= 1e-7 && Math.Abs(expected.Y - actual.Y) <= 1e-7 && Math.Abs(expected.Z - actual.Z) <= 1e-7;
    private static void AssertNear(double expected, double actual, double tolerance = 1e-7)
    {
        if (!double.IsFinite(actual) || Math.Abs(expected - actual) > tolerance) throw new InvalidOperationException($"Expected {expected:R}, got {actual:R}");
    }
    private static void AssertAngle(double expected, double actual)
    {
        var difference = (actual - expected) % MathHelper.TwoPI;
        if (difference > Math.PI) difference -= MathHelper.TwoPI;
        if (difference < -Math.PI) difference += MathHelper.TwoPI;
        AssertNear(0, difference, 1e-10);
    }
    private static void AssertContains(IEnumerable<string> values, string expected)
    {
        if (!values.Any(value => value.Contains(expected, StringComparison.Ordinal))) throw new InvalidOperationException($"Expected a failure containing '{expected}'.");
    }
    private static void AssertEqual<T>(T expected, T actual)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new InvalidOperationException($"Expected {expected}, got {actual}");
    }

    private sealed class TestDirectory : IDisposable
    {
        public string Path { get; }
        private TestDirectory(string path) => Path = path;
        public static TestDirectory Create()
        {
            var path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"native-dwg-self-test-{Guid.NewGuid():N}");
            Directory.CreateDirectory(path);
            return new TestDirectory(path);
        }
        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
