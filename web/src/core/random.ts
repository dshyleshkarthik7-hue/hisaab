/** CPython random.Random-compatible MT19937 stream and gauss() cache.
 * CPython's integer seeding, 53-bit random() and polar-independent gauss()
 * sequence are reproduced for unsigned 32-bit seeds used by Hisaab.
 */
export type RandomStream = (() => number) & { gauss: (mu?:number,sigma?:number)=>number };
const N=624, M=397, MATRIX_A=0x9908b0df, UPPER=0x80000000, LOWER=0x7fffffff;
function pythonRandom(seed:number):RandomStream {
 const mt=new Uint32Array(N); mt[0]=19650218;
 for(let i=1;i<N;i++) mt[i]=(Math.imul(1812433253,mt[i-1]^(mt[i-1]>>>30))+i)>>>0;
 const key=[seed>>>0];let i=1,j=0;
 for(let k=0;k<Math.max(N,key.length);k++){
  const prev=mt[i-1]^(mt[i-1]>>>30);
  mt[i]=(mt[i]^(Math.imul(prev,1664525)))+key[j]+j>>>0;
  i++;j++;if(i>=N){mt[0]=mt[N-1];i=1;}if(j>=key.length)j=0;
 }
 for(let k=0;k<N-1;k++){
  const prev=mt[i-1]^(mt[i-1]>>>30);
  mt[i]=((mt[i]^Math.imul(prev,1566083941))-i)>>>0;
  i++;if(i>=N){mt[0]=mt[N-1];i=1;}
 }
 mt[0]=UPPER;let index=N;
 const uint32=()=>{
  if(index>=N){
   for(let k=0;k<N;k++){
    const y=(mt[k]&UPPER)|(mt[(k+1)%N]&LOWER);
    mt[k]=(mt[(k+M)%N]^(y>>>1)^((y&1)?MATRIX_A:0))>>>0;
   }
   index=0;
  }
  let y=mt[index++];y^=y>>>11;y^=(y<<7)&0x9d2c5680;y^=(y<<15)&0xefc60000;y^=y>>>18;
  return y>>>0;
 };
 const random=(()=>{const fn=()=>{const a=uint32()>>>5,b=uint32()>>>6;return (a*67108864+b)/9007199254740992;};return fn;})() as RandomStream;
 let cached:number|null=null;
 random.gauss=(mu=0,sigma=1)=>{
  let z:number;
  if(cached!==null){z=cached;cached=null;}
  else{
   const x2pi=random()*2*Math.PI, g2rad=Math.sqrt(-2*Math.log(1-random()));
   z=Math.cos(x2pi)*g2rad;cached=Math.sin(x2pi)*g2rad;
  }
  return mu+z*sigma;
 };
 return random;
}
export function createRandomStreams(seed:number){
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new RangeError("Seed must be an unsigned 32-bit integer");
 const masks=[0x13579bdf,0x2468ace0,0x5a5a5a5a,0x6c8e9cf5,0x7f4a7c15] as const;
 const [inflation,market,debt,unemployment,medical]=masks.map(mask=>pythonRandom((seed^mask)>>>0));
 return {inflation,market,debt,unemployment,medical};
}
