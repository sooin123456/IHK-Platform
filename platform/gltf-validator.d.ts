declare module "gltf-validator" {
  type ValidationReport = {
    issues: {
      numErrors: number;
      numWarnings: number;
      numInfos: number;
      numHints: number;
      messages: Array<{ code: string; message: string; severity: number }>;
    };
  };

  const validator: {
    validateBytes(
      data: Uint8Array,
      options?: {
        format?: "glb" | "gltf";
        maxIssues?: number;
        writeTimestamp?: boolean;
      },
    ): Promise<ValidationReport>;
  };
  export default validator;
}
