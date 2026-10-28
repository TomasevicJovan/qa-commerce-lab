import { call, post, id } from './common.mjs';
export async function eventLoop(name, store, handler) {
  let kafka;
  if (process.env.EVENT_TRANSPORT === 'kafka') {
    const { Kafka } = await import('kafkajs');
    kafka = new Kafka({clientId:name,brokers:(process.env.KAFKA_BROKERS || '127.0.0.1:9092').split(',')});
    const admin=kafka.admin(); await admin.connect();
    try { await admin.createTopics({waitForLeaders:true,topics:[{topic:'commerce.events',numPartitions:1,replicationFactor:1}]}); } finally { await admin.disconnect(); }
  }
  const producer = kafka?.producer();
  if (producer) await producer.connect();
  const consume = async event => {
    const config = await call('broker','/config');
    if ((name === 'inventory' && config.pauseInventory) || (name === 'payments' && config.pausePayments)) return false;
    if (name === 'payments' && event.type === 'InventoryReserved' && config.paymentDelay) await new Promise(r=>setTimeout(r,config.paymentDelay));
    store.transaction(()=>{
      const seen = store.get('inbox',{}); if (seen[event.id]) return;
      handler(event,config); seen[event.id] = true; store.set('inbox',seen);
    });
    return true;
  };
  if (kafka) {
    const consumer = kafka.consumer({groupId:`qa-commerce-${name}`,sessionTimeout:30000});
    await consumer.connect(); await consumer.subscribe({topic:'commerce.events',fromBeginning:true});
    await consumer.run({autoCommit:false,eachMessage:async({topic,partition,message,heartbeat})=>{
      const event=JSON.parse(message.value.toString());
      while (!(await consume(event))) { await new Promise(r=>setTimeout(r,500)); await heartbeat(); }
      await consumer.commitOffsets([{topic,partition,offset:String(BigInt(message.offset)+1n)}]);
    }});
  }
  let busy = false;
  setInterval(async()=>{ if (busy) return; busy=true; try {
    const outbox=store.get('outbox',[]);
    for (const event of outbox) {
      if (producer) await producer.send({topic:'commerce.events',messages:[{key:event.orderId,value:JSON.stringify(event)}]});
      await call('broker','/events',post(event));
      // Remove only the published event: handlers can append while network calls await.
      store.set('outbox',store.get('outbox',[]).filter(e=>e.id!==event.id));
      const config=await call('broker','/config');
      if (config.duplicateEvents) {
        if (producer) await producer.send({topic:'commerce.events',messages:[{key:event.orderId,value:JSON.stringify(event)}]});
        else await call('broker','/events',post({...event,id:`${event.id}-redelivery`,originalId:event.id}));
      }
    }
    if (!kafka) {
      const rows=await call('broker',`/events?after=${store.get('cursor',0)}`);
      for (const event of rows) { if (!(await consume({...event,id:event.originalId || event.id}))) break; store.set('cursor',event.seq); }
    }
    store.set('eventError',null);
  } catch(e) { store.set('eventError',e.message); } finally { busy=false; } },200);
}
export function emit(store,type,orderId,data={}) {
  const event={id:id(),type,orderId,data,createdAt:new Date().toISOString()};
  store.set('outbox',[...store.get('outbox',[]),event]);
}
