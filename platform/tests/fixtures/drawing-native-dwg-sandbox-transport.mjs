import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// These finite Docker CLI doubles test host validation/lifecycle only. Real
// native parsing and Linux confinement are qualified in the integration suite.
export const imageId = `sha256:${"a".repeat(64)}`;
export const containerId = "b".repeat(64);
export const sourceBytes = Buffer.from("AC1024finite-invalid-native-fixture");
export const expectedSource = {
  sha256: createHash("sha256").update(sourceBytes).digest("hex"),
  byteSize: sourceBytes.length,
  headerVersion: "AC1024",
};
export const report = {
  schemaVersion: "1hk-dwg-import/1",
  qualification: "experimental-unqualified",
  source: expectedSource,
  engine: { name: "ACadSharp", version: "3.7.1" },
  coordinateSystem: "WCS_NATIVE_UNITS",
  unitCode: 4,
  modelSpaceHandle: "1F",
  layers: [],
  entities: [],
  unsupported: [],
  readerNotificationCount: 0,
  coverage: {
    modelSpaceEntities: 0,
    importedEntities: 0,
    unsupportedEntities: 0,
    nonModelSpaceEntities: 0,
  },
};
export async function transport(t, mode = "ok", change = {}, resave) {
  const directory = await mkdtemp(join(tmpdir(), "dwg-sandbox-test-"));
  const socket = join(directory, "docker.sock");
  const server = createServer((connection) => connection.end());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const dockerPath = join(directory, "docker");
  const log = join(directory, "calls.jsonl");
  const state = join(directory, "state.json");
  const profile = resave
    ? {
        prefix: "1hk-dwg-resave-",
        label: "org.1hk.native-dwg-resaver.attempt",
        command: "resave-native-stdio",
        memory: 2147483648,
      }
    : {
        prefix: "1hk-dwg-read-",
        label: "org.1hk.native-dwg-reader.attempt",
        command: "read-native-stdio",
        memory: 1073741824,
      };
  const script = `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
let configDirectory,configEntries,configMode;
if(args[0]==='--config') {
 configDirectory=args[1];args.splice(0,2);
 configEntries=fs.readdirSync(configDirectory);configMode=fs.statSync(configDirectory).mode & 511;
} else if(${JSON.stringify(mode)}==='hostile-home') {
 // Model Docker's documented passwd-home fallback without touching user config.
 fs.readFileSync(${JSON.stringify(join(directory, "hostile-home-config.json"))});
 fs.writeFileSync(${JSON.stringify(join(directory, "hostile-home-read"))},'read');
}
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args,env:process.env,configDirectory,configEntries,configMode})+'\\n');
if (args[0] !== '--host' || args[1] !== ${JSON.stringify(`unix://${socket}`)}) process.exit(71);
args.splice(0,2);
const profile=${JSON.stringify(profile)}, resave=${JSON.stringify(resave)}, mode=${JSON.stringify(mode)}, change=${JSON.stringify(change)}, id=${JSON.stringify(containerId)}, image=${JSON.stringify(imageId)};
const statePath=${JSON.stringify(state)};
const read=()=>JSON.parse(fs.readFileSync(statePath,'utf8'));
const save=(s)=>fs.writeFileSync(statePath,JSON.stringify(s));
const emit=(v)=>process.stdout.write(JSON.stringify(v));
if(args[0]==='info') { if(mode==='metadata-cap')process.stdout.write(Buffer.alloc(65537,32)); else emit({OSType:'linux',MemoryLimit:true,SwapLimit:true,CpuCfsPeriod:true,CpuCfsQuota:true,PidsLimit:true,SecurityOptions:['name=seccomp,profile=builtin','name=cgroupns'],...change.info}); }
else if(args[0]==='image' && args[1]==='inspect') {
 emit([{Id:image,Os:'linux',Config:{Volumes:null,ExposedPorts:null,Env:['PATH=/usr/bin:/bin','DOTNET_EnableDiagnostics=0'],Labels:{'org.1hk.native-dwg-reader.protocol':'1hk-dwg-import/1','org.1hk.native-dwg-resaver.protocol':'1hk-dwg-resave/1'}},...change.image}]);
} else if(args[0]==='create') {
 const nonce=args[args.indexOf('--name')+1].slice(profile.prefix.length);
 const command=['--signal=KILL',Math.ceil(Number(args[args.indexOf(image)+2].replace('s','')))+'s','/usr/share/dotnet/dotnet','/app/DwgEngineQualification.dll',profile.command];
 // Literal daemon receipt: expectations are not computed with production policy.
 const s={Id:id,Name:'/'+profile.prefix+nonce,Image:image,Platform:'linux',Path:'/usr/bin/timeout',Args:command,
 Config:{Image:image,User:'65532:65532',AttachStdin:true,AttachStdout:true,AttachStderr:true,OpenStdin:true,StdinOnce:false,Tty:false,Env:['PATH=/usr/bin:/bin','DOTNET_EnableDiagnostics=0'],Volumes:null,ExposedPorts:null,Entrypoint:['/usr/bin/timeout'],Cmd:command,Labels:{[profile.label]:nonce}},
 HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,CapAdd:null,CapDrop:['ALL'],SecurityOpt:['no-new-privileges=true'],NanoCpus:1000000000,Memory:profile.memory,MemorySwap:profile.memory,PidsLimit:64,CgroupnsMode:'private',PidMode:'',IpcMode:'private',ShmSize:67108864,UTSMode:'',UsernsMode:'',Binds:null,Mounts:null,Devices:[],DeviceRequests:null,DeviceCgroupRules:null,VolumesFrom:null,PortBindings:{},PublishAllPorts:false,ExtraHosts:null,Links:null,RestartPolicy:{Name:'no',MaximumRetryCount:0},AutoRemove:false,Init:true,LogConfig:{Type:'none',Config:{}},Tmpfs:{'/tmp':'rw,noexec,nosuid,nodev,size=16777216'},Ulimits:[{Name:'core',Soft:0,Hard:0}]},
 Mounts:[],NetworkSettings:{Networks:{none:{}}},State:{Status:'created',Running:false,Paused:false,Restarting:false,Dead:false,OOMKilled:false,ExitCode:0,Error:''}};
 Object.assign(s.HostConfig,change.host); Object.assign(s.Config,change.config); Object.assign(s,change.container);
 save(s);
 if(mode==='lost-create') {process.stderr.write('private daemon details');process.exitCode=1;}
 else if(mode==='hang-create') setTimeout(()=>process.exit(1),3000);
 else if(mode==='bad-id') process.stdout.write('malformed receipt');
 else process.stdout.write(id+'\\n');
} else if(args[0]==='container' && args[1]==='inspect') {
 if(!fs.existsSync(statePath)){process.stderr.write('No such container');process.exitCode=1;}
 else {const s=read(); if(s.started && mode==='foreign-cleanup') s.Config.Labels[profile.label]='f'.repeat(32); emit([s]);}
} else if(args[0]==='start') {
 const s=read(); s.started=true; s.State.Status='exited'; Object.assign(s.State,change.state); save(s);
 let bytes=[]; for await (const chunk of process.stdin) bytes.push(chunk);
 fs.writeFileSync(${JSON.stringify(join(directory, "stdin.bin"))},Buffer.concat(bytes));
 const emitReport=()=>{if(!resave) return emit({...${JSON.stringify(report)},...change.report}); const r=Buffer.from(JSON.stringify({...resave.report,...change.report}));const dwg=Buffer.from(resave.dwgHex,'hex');const h=Buffer.from([49,72,75,82,83,79,48,49,0,0,0,0,0,0,0,0]);h.writeUInt32BE(r.length,8);h.writeUInt32BE(dwg.length,12);process.stdout.write(Buffer.concat([h,r,dwg]));};
 if(mode==='hang-start') setTimeout(()=>process.exit(1),3000);
 else if(mode==='stdout-cap') process.stdout.write(Buffer.alloc(resave ? 16+201*1024*1024+1 : 32*1024*1024+1,32));
 else if(mode==='stderr-cap') process.stderr.write(Buffer.alloc(65537,65));
 else if(mode==='utf8') process.stdout.write(Buffer.from([255]));
 else if(mode==='bom') {process.stdout.write(Buffer.from([239,187,191]));emitReport();}
 else if(mode==='unexpected-stderr') {process.stderr.write('unexpected native output');emitReport();}
 else if(mode==='nonzero') {emitReport();process.exitCode=1;}
 else emitReport();
} else if(args[0]==='rm') {
 if(args.join(' ')!=='rm --force '+id) process.exit(72);
 if(mode==='remove-failure') process.exit(1);
 if(mode==='slow-remove') await new Promise(resolve=>setTimeout(resolve,400));
 if(mode==='replace-config') {fs.renameSync(configDirectory,configDirectory+'-owned');fs.mkdirSync(configDirectory);fs.writeFileSync(configDirectory+'/replacement-sentinel','keep');}
 fs.unlinkSync(statePath);process.stdout.write(id+'\\n');
} else process.exit(73);
`;
  await writeFile(dockerPath, script);
  await writeFile(
    join(directory, "hostile-home-config.json"),
    JSON.stringify({ auths: { "must-not-read": { auth: "private-fixture" } } }),
  );
  await chmod(dockerPath, 0o700);
  return {
    input: {
      dockerPath,
      dockerHost: `unix://${socket}`,
      imageId,
      sourceBytes: Buffer.from(sourceBytes),
      expectedSource,
      ...(resave
        ? {
            requestBytes: Buffer.from(resave.requestHex, "hex"),
            expectedRequestSha256: resave.report.request.sha256,
          }
        : {}),
      timeoutMilliseconds: 2500,
    },
    calls: async () =>
      (await readFile(log, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse),
    stateExists: async () =>
      readFile(state).then(
        () => true,
        () => false,
      ),
    stdin: () => readFile(join(directory, "stdin.bin")),
    hostileHomeRead: () =>
      access(join(directory, "hostile-home-read")).then(
        () => true,
        () => false,
      ),
  };
}
