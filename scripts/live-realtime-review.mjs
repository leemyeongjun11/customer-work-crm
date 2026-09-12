// Disposable in-memory UI fixture. Never opens or changes the user's .local-data/postgres database.
import {openDatabase} from '../apps/api/src/db.mjs';
import {provision} from '../apps/api/src/setup.mjs';
import {makeServer} from '../apps/api/src/server.mjs';
const db=await openDatabase({url:'',directory:''});
await provision(db,{password:'Realtime-review-only'});
const server=makeServer(db);
server.listen(4182,'127.0.0.1',()=>console.log('Disposable UI review: http://localhost:4182/live · admin@crm.local · Realtime-review-only'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.closeStreams();server.close(async()=>{await db.close();process.exit(0);});server.closeIdleConnections();});
