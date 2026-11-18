import fs from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dataDir } from './config.js';
import { importFastGptServiceVendorModule as service } from './common/vendor/fastgpt-vendor.js';

export async function serviceIdentity() {
  const { MongoUser }=await service('support/user/schema');
  const { MongoTeam }=await service('support/user/team/teamSchema');
  const { MongoTeamMember }=await service('support/user/team/teamMemberSchema');
  const { MongoOpenApi }=await service('support/openapi/schema');
  const { connectionMongo }=await service('common/mongo');
  const file=`${dataDir}/config/service-identity.json`;
  fs.mkdirSync(`${dataDir}/config`,{recursive:true,mode:0o700});
  let record=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):undefined;
  if(!record) {
    record={userId:new connectionMongo.Types.ObjectId().toString(),teamId:new connectionMongo.Types.ObjectId().toString(),tmbId:new connectionMongo.Types.ObjectId().toString(),apiKey:`fastgpt-${randomBytes(32).toString('hex')}`};
    fs.writeFileSync(file,JSON.stringify(record),{mode:0o600,flag:'wx'});
  }
  // Stable IDs make interrupted first boot idempotent. No password-login route is exposed.
  await MongoUser.updateOne({_id:record.userId},{$setOnInsert:{username:'knowledge-service',password:randomBytes(64).toString('hex'),status:'active'}},{upsert:true});
  await MongoTeam.updateOne({_id:record.teamId},{$setOnInsert:{name:'Knowledge Service',ownerId:record.userId}},{upsert:true});
  await MongoTeamMember.updateOne({_id:record.tmbId},{$setOnInsert:{userId:record.userId,teamId:record.teamId,name:'Knowledge Service',role:'owner',status:'active'}},{upsert:true});
  await MongoOpenApi.updateOne({apiKey:record.apiKey},{$setOnInsert:{teamId:record.teamId,tmbId:record.tmbId,name:'Knowledge service key'}},{upsert:true});
  const { createUserSession }=await service('support/user/session');
  const token=await createUserSession({userId:record.userId,teamId:record.teamId,tmbId:record.tmbId,isRoot:false});
  return {...record,token};
}

export function matchesServiceKey(header:unknown, expected:string) {
  if(typeof header!=='string' || !header.startsWith('Bearer ')) return false;
  const value=Buffer.from(header.slice(7)); const target=Buffer.from(expected);
  return value.length===target.length && timingSafeEqual(value,target);
}
