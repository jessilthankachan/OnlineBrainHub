import { isAdminRequest, sameOrigin } from "./_admin-auth.js";
const OLD = ["id","subject","category","topic","level","difficulty","question","opt1","opt2","opt3","opt4","correctIndex","explanation","hint"];
const NEW = ["id","level","subject","topic_id","subtopic_id","category","topic","difficulty","question","opt1","opt2","opt3","opt4","correctIndex","explanation","hint"];
const LEVELS = new Set(["ms","hs","hss"]), SUBJECTS = new Set(["math","phy","chem","bio","geo","hist"]);
function parseCSV(text) {
 const rows=[]; let row=[], cell="", quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i]; if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell="";}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell="";}else cell+=c;}
 if(quoted) throw new Error("CSV contains an unclosed quoted field."); if(cell.length||row.length){row.push(cell);if(row.some(x=>x.trim()))rows.push(row);} return rows;
}
function err(row,msg){return {row,message:msg};}
export async function onRequestPost({request,env}){
 if(!sameOrigin(request)) return Response.json({error:"Forbidden origin"},{status:403});
 if(!await isAdminRequest(request,env)) return Response.json({error:"Admin session expired. Please log in again."},{status:401});
 try{
  const ct=request.headers.get("Content-Type")||""; if(!ct.includes("text/csv")&&!ct.includes("text/plain")) return Response.json({error:"Send a CSV file as text/csv."},{status:415});
  const raw=await request.text(); if(raw.length>2_000_000) return Response.json({error:"CSV exceeds the 2 MB limit."},{status:413});
  const rows=parseCSV(raw); if(!rows.length) return Response.json({error:"CSV is empty."},{status:400});
  const header=rows.shift().map(x=>x.trim().replace(/^\uFEFF/,"")); const isNew=header.length===NEW.length&&NEW.every((x,i)=>header[i]===x); const isOld=header.length===OLD.length&&OLD.every((x,i)=>header[i]===x);
  if(!isOld&&!isNew) return Response.json({error:"Unrecognized CSV header. Download the matching 14-column old format or 16-column new format template.",expected:{old:OLD,new:NEW}},{status:400});
  if(rows.length>500) return Response.json({error:"Maximum 500 questions per import. Split larger files into batches."},{status:413});
  const errors=[], records=[], ids=new Set();
  rows.forEach((r,i)=>{const n=i+2; if(r.length!==header.length){errors.push(err(n,`Expected ${header.length} columns; found ${r.length}.`));return;}
   const v=r.map(x=>x.trim()); let q;
   if(isOld) q={id:v[0],subject:v[1],category:v[2],topic:v[3],level:v[4],difficulty:Number(v[5]),question:v[6],options:v.slice(7,11),correct:Number(v[11]),explanation:v[12],hint:v[13],topic_id:null,subtopic_id:null};
   else q={id:v[0],level:v[1],subject:v[2],topic_id:v[3],subtopic_id:v[4],category:v[5],topic:v[6],difficulty:Number(v[7]),question:v[8],options:v.slice(9,13),correct:Number(v[13]),explanation:v[14],hint:v[15]};
   const problems=[]; if(!q.id||q.id.length>160)problems.push("Invalid ID"); if(ids.has(q.id))problems.push("Duplicate ID in CSV"); ids.add(q.id);
   if(isNew){if(!LEVELS.has(q.level))problems.push("Level must be ms, hs or hss");if(!SUBJECTS.has(q.subject))problems.push("Invalid subject code");const prefix=`${q.level}_${q.subject}_`;if(!q.topic_id.startsWith(prefix)||!new RegExp(`^${q.level}_${q.subject}_t\\d{2}$`).test(q.topic_id))problems.push("Invalid topic_id");if(!new RegExp(`^${q.level}_${q.subject}_t\\d{2}_st\\d{2}$`).test(q.subtopic_id)||!q.subtopic_id.startsWith(q.topic_id+"_st"))problems.push("Invalid subtopic_id");if(!new RegExp(`^${q.level}_${q.subject}_t\\d{2}_st\\d{2}_d(?:1|5|10)_\\d{4}$`).test(q.id))problems.push("Question ID does not match the agreed format");if(!q.id.endsWith(`_d${q.difficulty}_`+q.id.split("_").at(-1)))problems.push("Question ID difficulty does not match difficulty column");}
   if(![1,5,10].includes(q.difficulty))problems.push("Difficulty must be 1, 5 or 10"); if(!q.question)problems.push("Question text is required"); if(q.options.length!==4||q.options.some(x=>!x))problems.push("All four options are required");if(!Number.isInteger(q.correct)||q.correct<0||q.correct>3)problems.push("correctIndex must be 0–3");
   if(problems.length)errors.push(err(n,problems.join("; ")));else records.push(q);
  });
  if(errors.length)return Response.json({success:false,validated:rows.length,inserted:0,errors},{status:400});
  if(!records.length)return Response.json({error:"No data rows found."},{status:400});

  // Check the live database before inserting. Chunk IDs to stay below SQLite/D1
  // bind-parameter limits. Reject the entire file if any ID already exists.
  const existingIds=[];
  for(let i=0;i<records.length;i+=90){
   const chunk=records.slice(i,i+90).map(q=>q.id);
   const placeholders=chunk.map(()=>"?").join(",");
   const result=await env.DB.prepare(`SELECT id FROM questions WHERE id IN (${placeholders})`).bind(...chunk).all();
   for(const row of (result.results||[])) existingIds.push(row.id);
  }
  if(existingIds.length){
   return Response.json({success:false,validated:records.length,inserted:0,duplicate_count:existingIds.length,duplicate_ids:existingIds,error:`Import rejected: ${existingIds.length} question ID(s) already exist in the database. No records were inserted.`},{status:409,headers:{"Cache-Control":"no-store"}});
  }

  const statements=records.map(q=>env.DB.prepare(`INSERT INTO questions (id,subject,category,topic,level,difficulty,question,options,correct,explanation,hint,topic_id,subtopic_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(q.id,q.subject,q.category,q.topic,q.level,q.difficulty,q.question,JSON.stringify(q.options),q.correct,q.explanation,q.hint,q.topic_id,q.subtopic_id));
  try {
   await env.DB.batch(statements);
  } catch(insertError) {
   // A concurrent import could create an ID after the pre-check. Keep the
   // database constraint as the final safeguard and return a readable error.
   const message=String(insertError?.message||"");
   if(message.includes("UNIQUE constraint failed")||message.includes("SQLITE_CONSTRAINT_PRIMARYKEY")){
    return Response.json({success:false,validated:records.length,inserted:0,error:"Import rejected: one or more question IDs already exist in the database. No records were imported. Please validate again with a fresh CSV."},{status:409,headers:{"Cache-Control":"no-store"}});
   }
   throw insertError;
  }
  return Response.json({success:true,validated:records.length,inserted:records.length,errors:[]},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({error:"Import failed. No success is assumed. Please check the CSV and server logs."},{status:400,headers:{"Cache-Control":"no-store"}});}
}
