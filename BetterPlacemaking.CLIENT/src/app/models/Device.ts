import { Config } from "./jetson-dtos/Config";

export interface Device {
    Id: string;
    ProjectId?: string;
    Name: string;
    Config: Config;
}