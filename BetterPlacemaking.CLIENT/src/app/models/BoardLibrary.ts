export type BoardType = 'charuco' | 'aruco';
export type BoardUnits = 'mm' | 'cm' | 'in';

export interface SaveBoardLibraryItemRequest {
  Type: BoardType;
  Nickname: string | null;
  Dictionary: string;
  Units: BoardUnits;
  Cols: number | null;
  Rows: number | null;
  MarkerId: number | null;
  SquareSize: number | null;
  MarkerSize: number;
  PreviewSvg: string;
}

export interface BoardLibraryItem {
  Id: string;
  Type: BoardType;
  Nickname: string;
  Dictionary: string;
  Units: BoardUnits;
  Cols: number | null;
  Rows: number | null;
  MarkerId: number | null;
  SquareSize: number | null;
  MarkerSize: number;
  SquareSizeMm: number | null;
  MarkerSizeMm: number;
  PreviewSvg: string;
  CreatedAtUtc: string;
}
