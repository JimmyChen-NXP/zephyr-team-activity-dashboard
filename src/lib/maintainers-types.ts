export type MaintainerEntry = {
  login: string;
  name: string;
  subsystems: string[];
};

export type MaintainersData = {
  generatedAt: string;
  maintainers: MaintainerEntry[];
  collaborators: MaintainerEntry[];
};
