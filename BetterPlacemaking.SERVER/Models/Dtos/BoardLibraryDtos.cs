namespace BetterPlacemaking.Models.Dtos
{
    public sealed record SaveBoardLibraryItemDto(
        string Type,
        string? Nickname,
        string Dictionary,
        string Units,
        int? Cols,
        int? Rows,
        int? MarkerId,
        double? SquareSize,
        double MarkerSize,
        string PreviewSvg
    );

    public sealed record BoardLibraryItemDto(
        string Id,
        string Type,
        string Nickname,
        string Dictionary,
        string Units,
        int? Cols,
        int? Rows,
        int? MarkerId,
        double? SquareSize,
        double MarkerSize,
        double? SquareSizeMm,
        double MarkerSizeMm,
        string PreviewSvg,
        DateTime CreatedAtUtc
    );
}
