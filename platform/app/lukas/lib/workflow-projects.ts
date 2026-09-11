import {z} from 'zod';
export const projectMemberSchema=z.object({name:z.string().trim().min(1).max(80),email:z.string().trim().toLowerCase().max(254).regex(/^\S+@\S+\.\S+$/),role:z.enum(['author','reviewer','approver','viewer'])});
export type ProjectMember=z.infer<typeof projectMemberSchema>;
const projectMembersSchema=z.array(projectMemberSchema).max(50).refine(members=>new Set(members.map(member=>member.email)).size===members.length);

export const projectsSchema=z.array(z.object({
 id:z.string().min(1).max(100),
 name:z.string().trim().min(1).max(120),
 kind:z.enum(['architecture','civil','both']),
 archived:z.boolean().optional(),
 members:projectMembersSchema.optional(),
})).max(30).refine(projects=>new Set(projects.map(project=>project.id)).size===projects.length);
export type LocalProject=z.infer<typeof projectsSchema>[number];
export function saveProjectMember(project:LocalProject,editorRole:string,input:unknown):LocalProject{
 const parsed=projectMemberSchema.safeParse(input);if(editorRole!=='admin'||!parsed.success)return project;
 const member=parsed.data,members=project.members??[],exists=members.some(row=>row.email===member.email);
 const next=exists?members.map(row=>row.email===member.email?member:row):[...members,member];
 return projectMembersSchema.safeParse(next).success?{...project,members:next}:project;
}
