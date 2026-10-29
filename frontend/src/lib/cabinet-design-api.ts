import type { CabinetDesign, DesignDocument } from "./cabinet-design";
export async function designRequest(token:string,action="",payload?:{revision:number;design?:CabinetDesign;id?:string}):Promise<DesignDocument> {
 const response=await fetch(`/api/admin/cabinet-design${action?`/${action}`:""}`,{method:payload?"POST":"GET",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},...(payload?{body:JSON.stringify(payload)}:{})});
 const data=await response.json();if(!response.ok)throw new Error(data.message||"Не удалось выполнить действие");return data;
}
