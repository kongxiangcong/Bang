// Closed provider output grammar. Runtime remains the authority for source IDs,
// read dependencies, human intent, stable identities, and common publication.
const str={type:'string'},strings={type:'array',items:str};
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const common={id:str,conditions:strings,uncertainty:str,sources:strings};
const operation=(type,fields={})=>object({type:{type:'string',const:type},...common,...fields});
const structure={anyOf:[
 object({version:{type:'integer',const:1},kind:{type:'string',enum:['classification','radial','argument','flow']},rootId:str}),
 object({version:{type:'integer',const:1},kind:{type:'string',const:'timeline'},rootId:str,eventTime:{type:['string','null']}}),
 object({version:{type:'integer',const:1},kind:{type:'string',const:'comparison'},rootId:str,dimensions:strings,option:{type:['string','null']},dimension:{type:['string','null']}})
]};
export const resultSchema=object({version:{type:'integer',const:1},changes:{type:'array',items:{anyOf:[
 operation('create-card',{text:str}),operation('create-card',{text:str,structure}),
 operation('edit-card',{text:str}),operation('supplement-card'),operation('delete-relation'),
 operation('create-relation',{fromNode:str,toNode:str,label:str}),
 operation('create-relation',{fromNode:str,toNode:str,label:str,kind:{type:'string',enum:['classification','general','support','refute','qualify','precedence','branch','dependency']}})
]}}});
