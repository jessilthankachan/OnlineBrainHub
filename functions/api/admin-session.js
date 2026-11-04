import { isAdminRequest } from "./_admin-auth.js";
export async function onRequestGet({request,env}) { return new Response(null,{status:await isAdminRequest(request,env)?204:401,headers:{"Cache-Control":"no-store"}}); }
