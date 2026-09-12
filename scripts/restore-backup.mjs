import {restoreToNewDirectory} from '../apps/api/src/backup.mjs';
const [file,keyFile,directory,...extra]=process.argv.slice(2);
if(!file||!keyFile||!directory||extra.length){console.error('Usage: node scripts/restore-backup.mjs <backup.crmbackup> <backup.key> <new-directory>');process.exitCode=1;}
else {
  try{console.log(JSON.stringify(await restoreToNewDirectory({file,keyFile,directory}),null,2));}
  catch(error){console.error(error.code==='EEXIST'?'Restore target already exists. Select a new empty path.':error.message);process.exitCode=1;}
}
