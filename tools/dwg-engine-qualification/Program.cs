namespace DwgEngineQualification;

internal static class Program
{
    public static int Main(string[] args)
    {
        if (args is ["self-test"])
        {
            return SelfTests.Run(Console.Out);
        }

        if (TryOption(args, "self-test-native", "--input-dir", out var inputDirectory))
            return NativeDwgSelfTests.Run(inputDirectory, Console.Out);

        if (TryOptions(args, "write-native", "--input", "--output-dir", out var manifest, out var nativeOutputDirectory))
            return NativeDwgWriter.Run(manifest, nativeOutputDirectory, Console.Out, Console.Error);

        if (TryOptions(args, "read-native", "--input", "--output-dir", out var nativeInput, out var nativeReadOutputDirectory))
            return NativeDwgReader.Run(nativeInput, nativeReadOutputDirectory, Console.Out, Console.Error);

        if (args is ["read-native-stdio"])
            return NativeDwgReader.RunStream(Console.OpenStandardInput(), Console.OpenStandardOutput(), Console.Error);

        if (args is ["resave-native-stdio"])
            return NativeDwgResaver.RunStream(Console.OpenStandardInput(), Console.OpenStandardOutput(), Console.Error);
        if (args.Length > 0 && args[0] == "resave-native-stdio")
        {
            Console.Error.WriteLine("native stream resave failed.");
            return 2;
        }

        if (TryOption(args, "create-generated-fixture", "--output-dir", out var fixtureDirectory))
            return QualificationRunner.CreateGeneratedFixture(fixtureDirectory, Console.Out, Console.Error);

        if (TryQualificationOptions(args, out var input, out var outputDirectory, out var edits))
            return QualificationRunner.Qualify(input, outputDirectory, Console.Out, Console.Error, edits);

        Console.Error.WriteLine("Usage:");
        Console.Error.WriteLine("  dwg-engine-qualification self-test");
        Console.Error.WriteLine("  dwg-engine-qualification self-test-native --input-dir <four-manifest-directory>");
        Console.Error.WriteLine("  dwg-engine-qualification write-native --input <manifest.json> --output-dir <new-directory>");
        Console.Error.WriteLine("  dwg-engine-qualification read-native --input <source.dwg> --output-dir <new-directory>");
        Console.Error.WriteLine("  dwg-engine-qualification read-native-stdio");
        Console.Error.WriteLine("  dwg-engine-qualification resave-native-stdio");
        Console.Error.WriteLine("  dwg-engine-qualification create-generated-fixture --output-dir <directory>");
        Console.Error.WriteLine("  dwg-engine-qualification qualify --input <input.dwg> --output-dir <directory> [--edits <request.json>]");
        return 2;
    }

    private static bool TryQualificationOptions(string[] args, out string input, out string output, out string? edits)
    {
        input = output = string.Empty;
        edits = null;
        if (args.Length is not (5 or 7) || args[0] != "qualify") return false;
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var i = 1; i < args.Length; i += 2)
            if (args[i] is not ("--input" or "--output-dir" or "--edits")
                || string.IsNullOrWhiteSpace(args[i + 1]) || !values.TryAdd(args[i], args[i + 1])) return false;
        values.TryGetValue("--edits", out edits);
        return values.TryGetValue("--input", out input!) && values.TryGetValue("--output-dir", out output!);
    }

    private static bool TryOption(string[] args, string command, string option, out string value)
    {
        value = string.Empty;
        if (args.Length != 3 || args[0] != command || args[1] != option) return false;
        value = args[2];
        return true;
    }

    private static bool TryOptions(
        string[] args,
        string command,
        string firstOption,
        string secondOption,
        out string firstValue,
        out string secondValue)
    {
        firstValue = string.Empty;
        secondValue = string.Empty;
        if (args.Length != 5 || args[0] != command) return false;

        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var i = 1; i < args.Length; i += 2) values[args[i]] = args[i + 1];
        return values.TryGetValue(firstOption, out firstValue!)
            && values.TryGetValue(secondOption, out secondValue!)
            && values.Count == 2;
    }
}
