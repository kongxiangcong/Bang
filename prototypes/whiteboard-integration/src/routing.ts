type Box={id:string;x:number;y:number;width:number;height:number};
export type Point=[number,number];
const GAP=8;
const key=(p:Point)=>`${p[0]},${p[1]}`;
const inside=(p:Point,r:Box)=>p[0]>r.x+.01&&p[0]<r.x+r.width-.01&&p[1]>r.y+.01&&p[1]<r.y+r.height-.01;
export function crosses(p:Point,q:Point,r:Box){
 let lo=0,hi=1;
 for(const [a,d,min,max] of [[p[0],q[0]-p[0],r.x+.01,r.x+r.width-.01],[p[1],q[1]-p[1],r.y+.01,r.y+r.height-.01]]){
  if(Math.abs(d)<.001){if(a<=min||a>=max)return false;}
  else{const a0=(min-a)/d,a1=(max-a)/d;lo=Math.max(lo,Math.min(a0,a1));hi=Math.min(hi,Math.max(a0,a1));}
 }
 return hi>lo&&hi>0&&lo<1;
}
/** Orthogonal visibility grid. Ports are normal to the card edge, matching focus=0 bindings. */
export function route(a:Box,b:Box,nodes:Box[]):Point[]{
 const obstacles=nodes.map(n=>({...n,x:n.x-GAP,y:n.y-GAP,width:n.width+GAP*2,height:n.height+GAP*2}));
 const ports=(n:Box):{p:Point;direction:number}[]=>[
  {p:[n.x+n.width+GAP,n.y+n.height/2],direction:0},
  {p:[n.x-GAP,n.y+n.height/2],direction:1},
  {p:[n.x+n.width/2,n.y+n.height+GAP],direction:2},
  {p:[n.x+n.width/2,n.y-GAP],direction:3}
 ];
 const starts=ports(a),ends=ports(b);
 const xs=[...new Set([...obstacles.flatMap(r=>[r.x-16,r.x+r.width+16]),...starts.map(s=>s.p[0]),...ends.map(s=>s.p[0])])].sort((a,b)=>a-b);
 const ys=[...new Set([...obstacles.flatMap(r=>[r.y-16,r.y+r.height+16]),...starts.map(s=>s.p[1]),...ends.map(s=>s.p[1])])].sort((a,b)=>a-b);
 const points:Point[]=[],lookup=new Map<string,number>();
 for(const x of xs)for(const y of ys){const p:Point=[x,y];if(!obstacles.some(r=>inside(p,r))){lookup.set(key(p),points.length);points.push(p)}}
 const neighbors=new Map<number,{id:number;direction:number;length:number}[]>();
 for(let i=0;i<points.length;i++){
  const p=points[i],xi=xs.indexOf(p[0]),yi=ys.indexOf(p[1]);
  for(const [x,y,direction] of [[xs[xi+1],p[1],0],[xs[xi-1],p[1],1],[p[0],ys[yi+1],2],[p[0],ys[yi-1],3]]){
   if(x===undefined||y===undefined)continue;const q:Point=[x,y],id=lookup.get(key(q));
   if(id!==undefined&&!obstacles.some(r=>crosses(p,q,r))){const list=neighbors.get(i)??[];list.push({id,direction,length:Math.abs(x-p[0])+Math.abs(y-p[1])});neighbors.set(i,list)}
  }
 }
 // State includes travel direction so bends have a small, predictable cost.
 const distances=new Map<number,number>(),previous=new Map<number,number>(),queue:{state:number;cost:number}[]=[];
 const push=(state:number,cost:number)=>{queue.push({state,cost});let i=queue.length-1;while(i){const p=(i-1)>>1;if(queue[p].cost<=cost)break;[queue[p],queue[i]]=[queue[i],queue[p]];i=p}};
 const pop=()=>{const top=queue[0],last=queue.pop()!;if(queue.length){queue[0]=last;let i=0;while(true){let c=i*2+1;if(c>=queue.length)break;if(c+1<queue.length&&queue[c+1].cost<queue[c].cost)c++;if(queue[i].cost<=queue[c].cost)break;[queue[c],queue[i]]=[queue[i],queue[c]];i=c}}return top};
 const startsByState=new Set<number>();
 for(const start of starts){const id=lookup.get(key(start.p));if(id===undefined)continue;const state=id*4+start.direction;distances.set(state,0);startsByState.add(state);push(state,0)}
 const goals=new Set(ends.flatMap(e=>{const id=lookup.get(key(e.p));return id===undefined?[]:[id*4+(e.direction^1)]}));
 let final:number|undefined;
 while(queue.length){const {state,cost}=pop();if(cost!==distances.get(state))continue;if(goals.has(state)){final=state;break}const id=Math.floor(state/4),direction=state%4;
  for(const next of neighbors.get(id)??[]){if(next.direction===(direction^1))continue;if(startsByState.has(state)&&next.direction!==direction)continue;const target=next.id*4+next.direction,nextCost=cost+next.length+(direction===next.direction?0:36);if(nextCost<(distances.get(target)??Infinity)){distances.set(target,nextCost);previous.set(target,state);push(target,nextCost)}}
 }
 if(final===undefined)return [[a.x+a.width+GAP,a.y+a.height/2],[b.x-GAP,b.y+b.height/2]];
 const path:Point[]=[];for(let s:number|undefined=final;s!==undefined;s=previous.get(s))path.unshift(points[Math.floor(s/4)]);
 return path.filter((p,i)=>i===0||i===path.length-1||!((path[i-1][0]===p[0]&&p[0]===path[i+1][0])||(path[i-1][1]===p[1]&&p[1]===path[i+1][1])));
}
