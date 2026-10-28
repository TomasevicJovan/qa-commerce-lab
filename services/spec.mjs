import { writeFileSync } from 'node:fs';
import { defaults } from './common.mjs';
const ref=name=>({$ref:`#/components/schemas/${name}`});
const json=schema=>({'application/json':{schema}});
const response=(description,schema)=>({description,...(schema?{content:json(schema)}:{})});
const error=response('Error',{type:'object',properties:{error:{type:'string'}}});
const body=schema=>({required:true,content:json(schema)});
const object=properties=>({type:'object',properties});
const string={type:'string'},integer={type:'integer'};
const address={type:'object',required:['name','line1','city','postalCode','country'],properties:Object.fromEntries(['name','line1','city','postalCode','country'].map(k=>[k,{type:'string',minLength:1,maxLength:200}]))};
const paths={};
function add(path,method,summary,{auth=false,input,output,code='200',parameters=[],description=''}={}){paths[path]||={};paths[path][method]={summary,description,tags:[path.split('/')[1]],security:auth?[{bearerAuth:[]}]:[],parameters,...(input?{requestBody:body(input)}:{}),responses:{[code]:response('Success',output),400:error,401:error,404:error,409:error,422:error,429:error,503:error}};}
const qp=(name,schema)=>({in:'query',name,schema});const orderParam={in:'path',name:'orderId',required:true,schema:string};
add('/auth/login','post','Issue a bearer session',{input:{type:'object',required:['email','password'],properties:{email:{type:'string',format:'email'},password:string}},output:ref('Session')});
add('/auth/register','post','Create a customer and session',{code:'201',input:{type:'object',required:['name','email','password'],properties:{name:string,email:{type:'string',format:'email'},password:{type:'string',minLength:8,maxLength:128}}},output:ref('Session')});
add('/auth/me','get','Read current user',{auth:true,output:ref('User')});add('/auth/logout','post','Revoke current session',{auth:true,output:object({loggedOut:{type:'boolean'}})});
add('/products','get','Search and paginate products',{parameters:[qp('q',string),qp('category',{type:'string',enum:['Audio','Workspace','Travel','Home']}),qp('sort',{type:'string',enum:['price']}),qp('page',{type:'integer',minimum:1,default:1}),qp('limit',{type:'integer',minimum:1,maximum:50,default:6})],output:object({items:{type:'array',items:ref('Product')},total:integer,page:integer,limit:integer})});
add('/products/{productId}','get','Read authoritative product price',{parameters:[{in:'path',name:'productId',required:true,schema:string}],output:ref('Product')});
add('/inventory','get','Read currently available stock',{output:{type:'object',additionalProperties:integer}});
add('/cart','get','Read current customer cart',{auth:true,output:{type:'array',items:ref('CartItem')}});
add('/cart','put','Replace customer cart',{auth:true,input:{type:'object',required:['items'],properties:{items:{type:'array',maxItems:20,items:ref('CartItem')}}},output:{type:'array',items:ref('CartItem')}});
add('/orders','get','List own orders',{auth:true,output:{type:'array',items:ref('Order')}});
add('/orders','post','Place asynchronous order',{auth:true,code:'202',parameters:[{in:'header',name:'Idempotency-Key',required:true,schema:{type:'string',maxLength:100}}],input:ref('Checkout'),output:ref('Order'),description:'202 for new orders; 200 for replay of the same key and request. Prices in USD cents. Poll GET /orders/{orderId} until terminal. Exact JSON request serialization is the idempotency fingerprint; reuse the exact body when retrying.'});
paths['/orders'].post.responses['200']=response('Idempotent replay',ref('Order'));
add('/orders/{orderId}','get','Read own order; another customer receives 404',{auth:true,parameters:[orderParam],output:ref('Order')});
add('/payments/{orderId}','get','Read payment for own order',{auth:true,parameters:[orderParam],output:object({orderId:string,id:string,status:{type:'string',enum:['pending','approved','failed']},amount:integer,reason:{type:'string',nullable:true},createdAt:{type:'string',format:'date-time'}})});
add('/lab/config','get','Read global scenario settings',{output:ref('LabConfig')});add('/lab/config','post','Patch global scenario settings',{input:ref('LabConfig'),output:ref('LabConfig')});
add('/lab/defaults','post','Restore scenario defaults, retain business data',{output:ref('LabConfig')});
add('/lab/status','get','Read service health and event processing status',{output:object({transport:{type:'string',enum:['local','kafka']},services:{type:'array',items:object({service:string,status:{type:'string',enum:['ok','degraded','unavailable']},eventError:{type:'string',nullable:true},pendingEvents:integer})}})});
add('/lab/events','get','Latest 100 events, newest first',{output:{type:'array',items:ref('Event')}});
const configProperties=Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,{type:typeof v==='number'?'integer':typeof v,default:v,...(typeof v==='number'?{minimum:k==='sessionSeconds'?1:0,maximum:k==='sessionSeconds'?86400:5000}:{})}]));
configProperties.locatorMode.enum=['stable','dynamic'];configProperties.paymentMode.enum=['approve','decline','timeout'];
const spec={openapi:'3.0.3',info:{title:'QA Commerce Lab API',version:'1.0.0',description:'Local training APIs. QA controls intentionally have no authentication. Do not expose this laboratory publicly.'},servers:[{url:'http://localhost:3000/api'},{url:'http://127.0.0.1:3000/api'}],paths,components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer'}},schemas:{
  User:object({id:string,email:string,name:string,role:string}),Session:object({token:string,user:ref('User'),expiresAt:{type:'integer',format:'int64'}}),
  Product:object({id:string,name:string,category:string,price:{type:'integer',description:'USD cents'},stock:{type:'integer',description:'Initial seed stock only; current availability is GET /inventory'},icon:string,color:string,description:string}),
  CartItem:{type:'object',required:['productId','quantity'],properties:{productId:string,quantity:{type:'integer',minimum:1,maximum:10}}},
  Checkout:{type:'object',required:['address','paymentMethod','expectedTotal'],properties:{address,paymentMethod:{type:'string',enum:['test-card','test-wallet']},coupon:{type:'string',enum:['','SAVE10','EXPIRED']},expectedTotal:{type:'integer',description:'Client calculated total in cents; mismatch returns 409'}}},
  Order:object({id:string,userId:string,items:{type:'array',items:object({productId:string,name:string,quantity:integer,unitPrice:integer})},address,paymentMethod:string,coupon:string,subtotal:integer,discount:integer,shipping:integer,total:integer,status:{type:'string',enum:['pending','payment_pending','confirmed','rejected','compensating','cancelled']},reason:{type:'string',nullable:true},createdAt:{type:'string',format:'date-time'},updatedAt:{type:'string',format:'date-time'},history:{type:'array',items:object({status:string,at:{type:'string',format:'date-time'},eventId:string})}}),
  LabConfig:{type:'object',additionalProperties:false,properties:configProperties},Event:object({seq:integer,id:string,originalId:string,type:string,orderId:string,data:{type:'object',additionalProperties:true},createdAt:{type:'string',format:'date-time'}})
}}};
writeFileSync(new URL('../docs/openapi.json',import.meta.url),JSON.stringify(spec,null,2)+'\n');
console.log('docs/openapi.json generated');
