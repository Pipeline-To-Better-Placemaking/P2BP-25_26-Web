export interface ProjectDto {
  Id: string;
  Title: string;
  Description: string;
  Location: string;
  WorkstationFolder?: string | null;
}
