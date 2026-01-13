import { Config } from "./jetson-dtos/Config";
import { HealthReport } from "./jetson-dtos/HealthReport";

export interface DeviceDto {
    Id: string;
    ProjectId?: string;
    Name: string;
    Config?: Config;
    HealthReport?: HealthReport;
}