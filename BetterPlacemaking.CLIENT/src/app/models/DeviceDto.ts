import { Config } from "./jetson-dtos/Config";

export interface DeviceDto {
    Id: string;
    ProjectId?: string;
    Name: string;
    Config: Config;
}