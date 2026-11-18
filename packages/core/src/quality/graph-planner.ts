import type {GraphPlan,GraphRelation,GraphDirection} from '../native/graph-contracts.ts';
export class SelectiveGraphPlanner {
  private policy:'legacy'|'relationships';
  constructor(policy:'legacy'|'relationships'='legacy'){this.policy=policy;}
  targets(query:string):string[]{
    if(this.policy==='relationships'){
      const subject=/^\s*([\w.$]+)\s+(?:is\s+)?called\s+(?:by|from)\b/iu.exec(query)??/^\s*([\w.$]+)\s+вызывается\s+из/iu.exec(query);
      if(subject&&!/^(?:who|what|что|кто)$/iu.test(subject[1]!))return[subject[1]!.replace(/\.+$/u,'')];
    }
    const patterns=[/\bcallers?(?:\s+of)?\s+([\w.$]+)/iu,/\bwho\s+calls\s+([\w.$]+)/iu,/кто\s+вызывает\s+([\w.$]+)/iu,/\bcalled\s+by\s+([\w.$]+)/iu,/что\s+вызывает\s+([\w.$]+)/iu,/(?:от\s+чего\s+зависит|наследуется|изменение)\s+([\w.$]+)/iu,/\b(?:dependencies\s+of|base\s+class\s+of|changing)\s+([\w.$]+)/iu];
    if(this.policy==='relationships')patterns.push(/\bwhat\s+does\s+([\w.$]+)\s+call/iu,/(?:зависимости\s+у|затронет\s+изменение)\s+([\w.$]+)/iu,/\b(?:functions?|methods?)\s+calls?\s+([\w.$]+)/iu,/\bwhat\s+calls\s+([\w.$]+)/iu,/\bcalled\s+from\s+([\w.$]+)/iu,/вызыва(?:ется|ются)\s+из\s+([\w.$]+)/iu);
    return [...new Set(patterns.flatMap(p=>{const m=p.exec(query);return m?[m[1]!.replace(/\.+$/u,'')]:[];}))];
  }
  plan(query:string,seeds:readonly string[],explicit?:{direction:GraphDirection;relations:readonly GraphRelation[]}):GraphPlan {
    const base={seeds:[...new Set(seeds)].slice(0,3),maxDepth:1,maxNodes:30,maxEdges:128,maxBonusChunks:3};
    const skip=(intent:GraphPlan['intent'],reason:string):GraphPlan=>({...base,mode:'skip',direction:'outgoing',relations:[],intent,reason});
    if(explicit)return{...base,...explicit,mode:'selective',intent:'explicit',reason:'Caller explicitly requested typed graph relations'};
    const pick=(intent:GraphPlan['intent'],direction:GraphDirection,relations:GraphRelation[],reason:string,maxDepth=1):GraphPlan=>({...base,mode:'selective',direction,relations,intent,reason,maxDepth});
    if(this.policy==='relationships'){
      // Classify the whole grammatical phrase before the ambiguous "called by" fragment.
      if(/\bwhat\s+does\s+[\w.$]+\s+call\b|\b(?:functions?|methods?)\s+(?:are\s+)?called\s+(?:by|from)\b|\b(?:who|what)\s+is\s+called\s+(?:by|from)\b|(?:что|какие\s+(?:функции|методы))\s+вызыва(?:ется|ются)\s+из/iu.test(query))return pick('calls','outgoing',['CALLS'],'Outgoing invocation relationship');
      if(/\bcalled\s+(?:from|by)\b|вызывается\s+из|\b(?:which|what)\s+(?:functions?|methods?)\s+calls?\b|^\s*what\s+calls\b/iu.test(query))return pick('callers','incoming',['CALLS'],'Incoming invocation relationship');
      if(/какие\s+части.*затрагива|какие\s+компоненты.*затрон/iu.test(query))return pick('impact','incoming',['CALLS','IMPORTS','INHERITS','REFERENCES'],'Change impact relationship',2);
    }
    if(/кто\s+вызыва|вызывающ|\bcallers?\b|\bwho\s+calls\b/iu.test(query))return pick('callers','incoming',['CALLS'],'Explicit callers query');
    if(/наследу|родительск|базов\w*\s+класс|\binherit\w*\b|\bbase\s+class\b|\bextends\b/iu.test(query))return pick('inheritance','outgoing',['INHERITS'],'Explicit base/inheritance query');
    if(/что\s+(?:сломается|затронет)|влияни|\bimpact\b|\baffected\b/iu.test(query))return pick('impact','incoming',['CALLS','IMPORTS','INHERITS','REFERENCES'],'Explicit change-impact query',2);
    if(/завис|\bdependenc\w*\b|\bdepend\w*\s+on\b/iu.test(query))return pick('dependency','outgoing',['CALLS','IMPORTS','INHERITS','REFERENCES'],'Explicit dependency query',2);
    if(/что\s+вызыва|какие\s+(?:функции|методы).*вызыва|\b(?:functions?|methods?)\s+(?:are\s+)?called\s+by\b|\bwhat\s+.*calls\b/iu.test(query))return pick('calls','outgoing',['CALLS'],'Explicit outgoing calls query');
    if(this.policy==='relationships'&&/\brelationships?\b|\binteract\w*\b|\bconnect\w*\b|связан|связь|связи|взаимодейств/iu.test(query)){
      if(base.seeds.length<2)return skip('unknown','Relationship intent lacks two structural symbol roots; completeness remains unverified');
      return pick('relationship','both',['CALLS','IMPORTS','INHERITS','REFERENCES','ORM_FOREIGNKEY','ORM_ONETOONEFIELD','ORM_MANYTOMANYFIELD','ORM_GENERICRELATION'],'Two structurally bound symbols support a selective relationship lookup',1);
    }
    if(/найди|объявлен|реализац|определени|\b(find|definition|implementation|class|function|method)\b/iu.test(query)||/^[\w.$/]+$/u.test(query.trim()))return skip('definition','Definition lookup needs no graph evidence');
    return skip('unknown','Unknown intent: graph need and semantic completeness remain unverified');
  }
}
