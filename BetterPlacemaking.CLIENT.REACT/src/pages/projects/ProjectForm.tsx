import { useState, type FormEvent } from "react";
import { Button, InputText, Panel, type DynamicDialogComponentProps } from "../../components/prime";
import type { ProjectDto } from "../../lib/projectTypes";
import {
  isValidWorkstationFolder,
  slugifyWorkstationFolder,
  WORKSTATION_FOLDER_HINT,
  WORKSTATION_FOLDER_MAX_LENGTH,
} from "../../lib/workstationFolder";

/** Opened through useDialogService().open(ProjectForm, { data: project }) - mirrors the Angular DynamicDialog form. */
export function ProjectForm({ data, dialogRef }: DynamicDialogComponentProps<ProjectDto | undefined, ProjectDto>) {
  const existing = data;
  const [title, setTitle] = useState(existing?.Title ?? "");
  const [description, setDescription] = useState(existing?.Description ?? "");
  const [location, setLocation] = useState(existing?.Location ?? "");
  // The folder is set-once: read-only when the project already has one
  const lockedFolder = existing?.WorkstationFolder || "";
  const isCreate = !existing?.Id;
  const [folder, setFolder] = useState(lockedFolder || (isCreate ? slugifyWorkstationFolder(title) : ""));
  // On create the folder follows the title until the user edits it
  const [folderEdited, setFolderEdited] = useState(false);
  const folderInvalid = !lockedFolder && folder !== "" && !isValidWorkstationFolder(folder);
  const invalid = title === "" || folderInvalid;

  function onTitleChange(value: string) {
    setTitle(value);
    if (isCreate && !folderEdited) setFolder(slugifyWorkstationFolder(value));
  }

  function onFolderChange(value: string) {
    setFolderEdited(true);
    setFolder(value);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (invalid) return;
    dialogRef.close({
      ...existing,
      Id: existing?.Id ?? "",
      Title: title,
      Description: description,
      Location: location,
      WorkstationFolder: lockedFolder || folder || null,
    } as ProjectDto);
  }

  return (
    <form onSubmit={onSubmit} className="p-fluid flex flex-col gap-4 p-4">
      <Panel header="Project Details">
        <div className="grid gap-4 md:grid-cols-2">
          {existing?.Id ? (
            <div className="flex flex-col gap-1 md:col-span-2">
              <label htmlFor="project-id" className="font-semibold">Id</label>
              <InputText id="project-id" disabled value={existing.Id} readOnly />
            </div>
          ) : null}

          <div className="flex flex-col gap-1 md:col-span-2">
            <label htmlFor="project-title" className="font-semibold">Title</label>
            <InputText id="project-title" value={title} onChange={(e) => onTitleChange(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1 md:col-span-2">
            <label htmlFor="project-description" className="font-semibold">Description</label>
            <InputText id="project-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="project-location" className="font-semibold">Location</label>
            <InputText id="project-location" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="project-workstation-folder" className="font-semibold">Workstation folder</label>
            <InputText
              id="project-workstation-folder"
              value={folder}
              readOnly={!!lockedFolder}
              disabled={!!lockedFolder}
              invalid={folderInvalid}
              maxLength={WORKSTATION_FOLDER_MAX_LENGTH}
              aria-describedby="project-workstation-folder-hint"
              onChange={(e) => onFolderChange(e.target.value)}
            />
            <small
              id="project-workstation-folder-hint"
              className={folderInvalid ? "text-xs text-red-600" : "text-xs text-ink-muted"}
            >
              {lockedFolder ? "The workstation folder cannot be changed once set." : WORKSTATION_FOLDER_HINT}
            </small>
          </div>
        </div>
      </Panel>

      <div className="flex justify-end gap-2">
        <Button type="button" label="Cancel" className="p-button-text" onClick={() => dialogRef.close()} />
        <Button type="submit" label="Save" disabled={invalid} />
      </div>
    </form>
  );
}
