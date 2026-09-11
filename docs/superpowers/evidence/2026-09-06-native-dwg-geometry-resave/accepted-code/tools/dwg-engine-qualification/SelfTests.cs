using ACadSharp;
using ACadSharp.Entities;
using ACadSharp.Tables;
using CSMath;

namespace DwgEngineQualification;

internal static class SelfTests
{
    public static int Run(TextWriter output)
    {
        var tests = new (string Name, Action Body)[]
        {
            ("refuses an input located inside the output directory", RejectsInputOutputCollision),
            ("rejects an output name that escapes the explicit output directory", RejectsOutputEscape),
            ("reports a removed untouched entity", ReportsRemovedUntouchedEntity),
            ("reports a changed untouched entity", ReportsChangedUntouchedEntity),
            ("rejects an output-directory symlink that aliases the input parent", RejectsSymlinkAliasedCollision),
            ("bounds a directory collision at the working-copy path", BoundsWorkingCopyDirectoryCollision),
            ("inventories supported orientation and alignment fields", InventoriesSupportedGeometryFields),
            ("marks non-empty insert attributes as an explicit semantic inventory gap", DiagnosesInsertAttributeGap),
            ("diagnoses duplicate entity handles instead of silently collapsing them", DiagnosesDuplicateHandles),
            ("qualifies without silently editing the first entities", SelectedDwgEditSelfTests.NoImplicitEdits),
            ("edits only explicit non-first handles on a pinned DWG copy", SelectedDwgEditSelfTests.EditsSelectedHandles),
            ("rejects malformed, stale, duplicate and unsupported edit targets without output", SelectedDwgEditSelfTests.RejectsInvalidEdits),
            ("validates every selected target before mutating any entity", SelectedDwgEditSelfTests.ValidatesBatchBeforeMutation),
            ("edits all five strict v2 geometry types and preserves selected identities", SelectedDwgGeometrySelfTests.EditsAllSupportedV2Geometry),
            ("retains polyline vertices by index for closure, movement and count changes", SelectedDwgGeometrySelfTests.PreservesPolylineVerticesByIndex),
            ("rejects lossy retained polyline vertex identifiers before mutation", SelectedDwgGeometrySelfTests.RejectsLossyVertexIdentifiersBeforeMutation),
            ("rejects invalid v2 payloads and reader-ineligible targets atomically", SelectedDwgGeometrySelfTests.RejectsInvalidV2PayloadsAndTargets),
            ("rejects malformed and over-budget v2 requests", SelectedDwgGeometrySelfTests.RejectsV2BudgetsAndMalformedText),
            ("rejects retained unknown objects before mutating v2 targets", SelectedDwgGeometrySelfTests.RejectsRetainedUnknownObjectsBeforeMutation),
            ("rejects resulting document point overflow before mutating v2 targets", SelectedDwgGeometrySelfTests.RejectsResultingDocumentPointOverflowBeforeMutation),
            ("detects an unrequested LINE normal change", SelectedDwgEditSelfTests.DetectsLineNormalChange),
            ("detects a switch between similarly numbered style and block references", SelectedDwgEditSelfTests.DetectsReferenceChange),
            ("reads literal native geometry and preserves source bytes", NativeDwgReaderSelfTests.ReadsRealDwgGeometryAndPreservesSource),
            ("counts unsupported native geometry without fabrication", NativeDwgReaderSelfTests.CountsUnsupportedGeometryWithoutFabrication),
            ("keeps attribute definitions out of plain TEXT import", NativeDwgReaderSelfTests.KeepsAttributeDefinitionsOutOfPlainTextImport),
            ("rejects malformed native input and existing output", NativeDwgReaderSelfTests.RejectsMalformedInputAndExistingOutput),
            ("rejects external DWG references without producing output", NativeDwgReaderSelfTests.RejectsExternalReferencesWithoutOutput),
            ("accepts a full-turn ARC and appearance-only PLINEGEN", NativeDwgReaderSelfTests.AcceptsFullTurnArcAndPlinegenPolyline),
            ("counts classic polyline vertices in the global budget", NativeDwgReaderSelfTests.CountsClassicPolylineVerticesInGlobalBudget),
            ("publishes one durable report under concurrent output", NativeDwgReaderSelfTests.ConcurrentOutputHasOneOwnerAndOneReport),
            ("rejects corrupt DWG instead of reporting failsafe coverage", NativeDwgReaderSelfTests.RejectsCorruptionInsteadOfReportingFailsafeCoverage),
            ("pipes a real generated DWG through the actual stream CLI", NativeDwgStreamSelfTests.CliReadsRealDwgFromBinaryStandardInput),
            ("reads a non-seekable chunked native DWG stream", NativeDwgStreamSelfTests.ReadsNonSeekableChunkedInput),
            ("rejects malformed native streams without partial success output", NativeDwgStreamSelfTests.RejectsMalformedStreamsWithoutSuccessOutput),
            ("bounds generated native stream input without partial success output", NativeDwgStreamSelfTests.RejectsOversizedGeneratedStreamWithoutSuccessOutput),
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

    private static void RejectsInputOutputCollision()
    {
        using var temp = TestDirectory.Create();
        var outputDirectory = Path.Combine(temp.Path, "output");
        Directory.CreateDirectory(outputDirectory);
        var input = Path.Combine(outputDirectory, "input.dwg");
        File.WriteAllText(input, "synthetic test input");

        AssertThrows<ArgumentException>(() => QualificationPaths.Create(input, outputDirectory));
    }

    private static void RejectsOutputEscape()
    {
        using var temp = TestDirectory.Create();
        AssertThrows<ArgumentException>(() => QualificationPaths.BoundedOutputPath(temp.Path, "../escape.dwg"));
    }

    private static void ReportsRemovedUntouchedEntity()
    {
        var before = Inventory("10", "LINE", "0", "0,0,0|10,0,0");
        var after = new CadInventory([], "Millimeters");

        var result = SemanticComparer.Compare(before, after, ExpectedEdits.None, 1e-9);

        AssertContains(result.Failures, "untouched entity 10 was removed");
    }

    private static void ReportsChangedUntouchedEntity()
    {
        var before = Inventory("10", "LINE", "0", "0,0,0|10,0,0");
        var after = Inventory("10", "LINE", "0", "0,0,0|11,0,0");

        var result = SemanticComparer.Compare(before, after, ExpectedEdits.None, 1e-9);

        AssertContains(result.Failures, "untouched entity 10 geometry changed");
    }

    private static void RejectsSymlinkAliasedCollision()
    {
        using var temp = TestDirectory.Create();
        var realDirectory = Path.Combine(temp.Path, "real");
        var aliasDirectory = Path.Combine(temp.Path, "alias");
        Directory.CreateDirectory(realDirectory);
        Directory.CreateSymbolicLink(aliasDirectory, realDirectory);
        var input = Path.Combine(realDirectory, "input.dwg");
        File.WriteAllText(input, "synthetic test input");

        AssertThrows<ArgumentException>(() => QualificationPaths.Create(input, aliasDirectory));
    }

    private static void BoundsWorkingCopyDirectoryCollision()
    {
        using var temp = TestDirectory.Create();
        var input = Path.Combine(temp.Path, "input.dwg");
        var outputDirectory = Path.Combine(temp.Path, "output");
        File.WriteAllText(input, "synthetic test input");
        Directory.CreateDirectory(Path.Combine(outputDirectory, "input-working-copy.dwg"));
        var errors = new StringWriter();

        var result = QualificationRunner.Qualify(input, outputDirectory, new StringWriter(), errors);

        AssertEqual(2, result);
        AssertContains(errors.ToString(), "Refusing to overwrite existing output");
    }

    private static void InventoriesSupportedGeometryFields()
    {
        var diagnostics = new List<string>();
        var circle = QualificationRunner.InventoryEntity(
            new Circle(new XYZ(1, 2, 3), 4), diagnostics);
        var arc = QualificationRunner.InventoryEntity(
            new Arc(new XYZ(1, 2, 3), 4, 0.1, 0.9) { Thickness = 2 }, diagnostics);
        var polyline = QualificationRunner.InventoryEntity(
            new LwPolyline(new[] { new XY(1, 2), new XY(3, 4) })
            {
                Thickness = 2,
                ConstantWidth = 3,
            }, diagnostics);
        var text = QualificationRunner.InventoryEntity(new TextEntity
        {
            InsertPoint = new XYZ(1, 2, 3),
            AlignmentPoint = new XYZ(4, 5, 6),
            Value = "QA",
        }, diagnostics);
        var insert = QualificationRunner.InventoryEntity(
            new Insert(new BlockRecord("QA_BLOCK")) { InsertPoint = new XYZ(1, 2, 3) }, diagnostics);

        AssertContains(circle.Geometry, "normal=");
        AssertContains(arc.Geometry, "thickness=2;normal=");
        AssertContains(polyline.Geometry, "normal=");
        AssertContains(polyline.Geometry, "thickness=2;constantWidth=3");
        AssertContains(text.Geometry, "alignment=4,5,6;normal=");
        AssertContains(text.Geometry, "horizontal=");
        AssertContains(text.Geometry, "vertical=");
        AssertContains(insert.Geometry, "normal=");
    }

    private static void DiagnosesDuplicateHandles()
    {
        var document = new CadDocument();
        var first = new Line(new XYZ(0, 0, 0), new XYZ(1, 0, 0));
        var second = new Line(new XYZ(0, 1, 0), new XYZ(1, 1, 0));
        document.Entities.Add(first);
        document.Entities.Add(second);
        typeof(CadObject).GetProperty(nameof(CadObject.Handle))!
            .SetValue(second, first.Handle);
        var diagnostics = new List<string>();

        var inventory = QualificationRunner.Inventory(document, diagnostics);
        var comparison = SemanticComparer.Compare(
            inventory, inventory, ExpectedEdits.None, 1e-9);

        AssertContains(diagnostics, $"duplicate entity handle {first.Handle:X} occurs 2 times");
        AssertContains(
            comparison.Failures,
            $"before inventory contains duplicate entity handle {first.Handle:X}");
    }

    private static void DiagnosesInsertAttributeGap()
    {
        var insert = new Insert(new BlockRecord("QA_ATTRIBUTE_BLOCK"));
        typeof(CadObject).GetProperty(nameof(CadObject.Handle))!
            .SetValue(insert, 0xA1UL);
        insert.Attributes.Add(new AttributeEntity
        {
            Tag = "ROOM",
            Value = "101",
        });
        var diagnostics = new List<string>();

        QualificationRunner.InventoryEntity(insert, diagnostics);

        AssertContains(
            diagnostics,
            "unsupported inventory fields for INSERT handle A1: attribute tags, values, geometry, and ownership");
    }

    private static CadInventory Inventory(string handle, string type, string layer, string geometry) =>
        new([new EntityInventory(handle, type, "model-space", layer, geometry, null)], "Millimeters");

    private static void AssertContains(IReadOnlyList<string> values, string expected)
    {
        if (!values.Contains(expected, StringComparer.Ordinal))
        {
            throw new InvalidOperationException($"Expected failure '{expected}', got [{string.Join(", ", values)}]");
        }
    }

    private static void AssertContains(string value, string expected)
    {
        if (!value.Contains(expected, StringComparison.Ordinal))
            throw new InvalidOperationException($"Expected '{value}' to contain '{expected}'");
    }

    private static void AssertEqual<T>(T expected, T actual)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new InvalidOperationException($"Expected {expected}, got {actual}");
    }

    private static void AssertThrows<T>(Action action) where T : Exception
    {
        try
        {
            action();
        }
        catch (T)
        {
            return;
        }

        throw new InvalidOperationException($"Expected {typeof(T).Name}");
    }

    private sealed class TestDirectory : IDisposable
    {
        public string Path { get; }

        private TestDirectory(string path) => Path = path;

        public static TestDirectory Create()
        {
            var path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"dwg-qualification-test-{Guid.NewGuid():N}");
            Directory.CreateDirectory(path);
            return new TestDirectory(path);
        }

        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
