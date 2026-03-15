export type PersonEntry = {
  login: string;
  name: string;
};

/** "component" = has GitHub labels (a named subsystem); "file-group" = file-path-only entry */
export type SubsystemType = "component" | "file-group";

export type SubsystemEntry = {
  name: string;
  type: SubsystemType;
  maintainers: PersonEntry[];
  collaborators: PersonEntry[];
};

export type MaintainersData = {
  generatedAt: string;
  subsystems: SubsystemEntry[];
};
