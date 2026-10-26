/** Ideal op amps with zero input current; capacitor admittances are solved at s=jω. */
export type Complex = readonly [number,number];
export const z=(real=0,imag=0):Complex=>[real,imag];
export const add=(a:Complex,b:Complex):Complex=>[a[0]+b[0],a[1]+b[1]];
export const mul=(a:Complex,b:Complex):Complex=>[a[0]*b[0]-a[1]*b[1],a[0]*b[1]+a[1]*b[0]];
export const scale=(a:Complex,b:number):Complex=>[a[0]*b,a[1]*b];
export const div=(a:Complex,b:Complex):Complex=>{const d=b[0]*b[0]+b[1]*b[1];return [(a[0]*b[0]+a[1]*b[1])/d,(a[1]*b[0]-a[0]*b[1])/d];};
export const magnitude=(a:Complex)=>Math.hypot(...a);
export interface Branch { a:string;b:string;r?:number;c?:number }
export interface IdealAmp { out:string;plus:string;minus:string }
export interface Network { fixed:Record<string,Complex>;branches:Branch[];amps:IdealAmp[];currents:Record<string,Complex>;output:string }
export function solveNetwork(net:Network,frequency:number):Record<string,Complex> {
  const names=[...new Set([...net.branches.flatMap(b=>[b.a,b.b]),...net.amps.flatMap(a=>[a.out,a.plus,a.minus]),...Object.keys(net.currents)])].filter(n=>net.fixed[n]===undefined);
  const indexes=new Map(names.map((n,i)=>[n,i])),n=names.length;
  const matrix=names.map(()=>Array.from({length:n+1},()=>z()));
  const stamp=(row:number,name:string,value:Complex)=>{
    const col=indexes.get(name);
    if(col!==undefined)matrix[row][col]=add(matrix[row][col],value);
    else matrix[row][n]=add(matrix[row][n],scale(mul(value,net.fixed[name]),-1));
  };
  names.forEach((name,i)=>{
    const amp=net.amps.find(a=>a.out===name);
    if(amp){stamp(i,amp.plus,z(1));stamp(i,amp.minus,z(-1));return;}
    matrix[i][n]=net.currents[name]??z();
    net.branches.forEach(b=>{
      if(b.a!==name&&b.b!==name)return;
      const admittance=b.r!==undefined?z(1/b.r):z(0,2*Math.PI*frequency*b.c!);
      stamp(i,name,admittance);stamp(i,b.a===name?b.b:b.a,scale(admittance,-1));
    });
  });
  // Row normalization makes pivoting independent of resistance/capacitance units.
  for(const row of matrix){const m=Math.max(...row.slice(0,n).map(magnitude));if(m===0)throw Error('浮空节点或无直流反馈');for(let j=0;j<=n;j++)row[j]=scale(row[j],1/m);}
  for(let i=0;i<n;i++) {
    let pivot=i;for(let j=i+1;j<n;j++)if(magnitude(matrix[j][i])>magnitude(matrix[pivot][i]))pivot=j;
    if(magnitude(matrix[pivot][i])<1e-13)throw Error('反馈网络奇异或病态，请调整电阻比例与负载');
    [matrix[i],matrix[pivot]]=[matrix[pivot],matrix[i]];
    const d=matrix[i][i];for(let k=i;k<=n;k++)matrix[i][k]=div(matrix[i][k],d);
    for(let j=0;j<n;j++)if(j!==i){const factor=matrix[j][i];for(let k=i;k<=n;k++)matrix[j][k]=add(matrix[j][k],scale(mul(factor,matrix[i][k]),-1));}
  }
  const result={...net.fixed,...Object.fromEntries(names.map((name,i)=>[name,matrix[i][n]]))};
  if(Object.values(result).some(v=>!v.every(Number.isFinite)))throw Error('网络结果超出数值范围');
  return result;
}
