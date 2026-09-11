export const screenBlocks = [
  {
    name: "단일 여닫이문",
    group: "문·창",
    size: "900 × 2,100 mm",
    code: "D-01",
    detail: "폭·높이·열림 방향을 가진 문 블록의 속성 예시",
  },
  {
    name: "양개 여닫이문",
    group: "문·창",
    size: "1,600 × 2,100 mm",
    code: "D-02",
    detail: "양개문을 반복 배치할 때 사용할 속성 예시",
  },
  {
    name: "기본 창",
    group: "문·창",
    size: "1,200 × 1,500 mm",
    code: "W-01",
    detail: "창호 번호와 크기를 관리하는 속성 예시",
  },
  {
    name: "6인 회의 테이블",
    group: "가구",
    size: "2,400 × 1,000 mm",
    code: "F-01",
    detail: "회의실 배치를 위한 가구 속성 예시",
  },
  {
    name: "업무용 책상",
    group: "가구",
    size: "1,400 × 700 mm",
    code: "F-02",
    detail: "반복 배치하는 업무용 가구의 속성 예시",
  },
  {
    name: "기본 칸막이",
    group: "벽체",
    size: "두께 100 mm",
    code: "P-01",
    detail: "두께·분류를 가진 칸막이 속성 예시",
  },
] as const;
export type ScreenBlockCode=typeof screenBlocks[number]["code"];
export function validScreenBlockCode(code:unknown):code is ScreenBlockCode{return screenBlocks.some(block=>block.code===code);}
export function ScreenBlockGlyph({code,strokeWidth=2,fill="none"}:{code:ScreenBlockCode;strokeWidth?:number;fill?:string}){
 return <g fill={fill} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {code==="D-01"&&<><path d="M25 90h25V25M50 90h65M50 25a65 65 0 0 1 65 65M115 90h40"/><path d="M25 96h25m65 0h40"/></>}
      {code==="D-02"&&<><path d="M20 90h25V45m0 45h90V45m0 45h25M45 45a45 45 0 0 1 45 45 45 45 0 0 1 45-45"/><path d="M20 96h25m90 0h25"/></>}
      {code==="W-01"&&<><path d="M20 40h140v30H20zM35 40v30m110-30v30M35 50h110M35 60h110M90 50v10"/></>}
      {code==="F-01"&&<><rect x="35" y="35" width="110" height="40" rx="8"/>{[45,80,115].map(x=><g key={x}><rect x={x} y="18" width="20" height="12" rx="3"/><rect x={x} y="80" width="20" height="12" rx="3"/></g>)}</>}
      {code==="F-02"&&<><rect x="30" y="22" width="120" height="48" rx="3"/><path d="M48 28h30v18H48zM42 52h42M124 22v48"/><rect x="72" y="78" width="36" height="20" rx="6"/></>}
      {code==="P-01"&&<><path d="M20 45h140v20H20z"/>{[30,50,70,90,110,130,150].map(x=><path key={x} d={`M${x} 65l10-20`}/>)}</>}
    </g>;
}
