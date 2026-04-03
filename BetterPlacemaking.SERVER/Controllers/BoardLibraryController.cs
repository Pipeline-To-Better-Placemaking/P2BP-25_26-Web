using System.Security.Claims;
using BetterPlacemaking.Models;
using BetterPlacemaking.Models.Dtos;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/board-library")]
    [Authorize(Policy = "UserJwt")]
    public sealed class BoardLibraryController(BoardLibraryService boardLibraryService) : ControllerBase
    {
        private readonly BoardLibraryService _boardLibraryService = boardLibraryService;

        [HttpGet]
        public IActionResult GetMine()
        {
            var userId = ResolveCurrentUserId();
            if (string.IsNullOrWhiteSpace(userId))
                return Unauthorized("Missing user id claim.");

            try
            {
                var items = _boardLibraryService.ListForUser(userId)
                    .Select(ToDto)
                    .ToList();
                return Ok(items);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while loading board library items.");
            }
        }

        [HttpGet("{id}")]
        public IActionResult GetById(string id)
        {
            var userId = ResolveCurrentUserId();
            if (string.IsNullOrWhiteSpace(userId))
                return Unauthorized("Missing user id claim.");

            if (string.IsNullOrWhiteSpace(id))
                return BadRequest("id is required.");

            try
            {
                var item = _boardLibraryService.GetByIdForUser(userId, id);
                if (item == null)
                    return NotFound("Board not found.");

                return Ok(ToDto(item));
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while loading the board.");
            }
        }

        [HttpPost]
        public IActionResult Save([FromBody] SaveBoardLibraryItemDto dto)
        {
            var userId = ResolveCurrentUserId();
            if (string.IsNullOrWhiteSpace(userId))
                return Unauthorized("Missing user id claim.");

            if (dto == null)
                return BadRequest("Invalid payload.");

            try
            {
                var saved = _boardLibraryService.SaveForUser(userId, dto);
                return Ok(ToDto(saved));
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while saving the board.");
            }
        }

        [HttpPut("{id}")]
        public IActionResult Update(string id, [FromBody] SaveBoardLibraryItemDto dto)
        {
            var userId = ResolveCurrentUserId();
            if (string.IsNullOrWhiteSpace(userId))
                return Unauthorized("Missing user id claim.");

            if (string.IsNullOrWhiteSpace(id))
                return BadRequest("id is required.");

            if (dto == null)
                return BadRequest("Invalid payload.");

            try
            {
                var updated = _boardLibraryService.UpdateForUser(userId, id, dto);
                return Ok(ToDto(updated));
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (KeyNotFoundException)
            {
                return NotFound("Board not found.");
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while updating the board.");
            }
        }

        [HttpDelete("{id}")]
        public IActionResult Delete(string id)
        {
            var userId = ResolveCurrentUserId();
            if (string.IsNullOrWhiteSpace(userId))
                return Unauthorized("Missing user id claim.");

            if (string.IsNullOrWhiteSpace(id))
                return BadRequest("id is required.");

            try
            {
                var deleted = _boardLibraryService.DeleteForUser(userId, id);
                if (!deleted)
                    return NotFound("Board not found.");

                return NoContent();
            }
            catch (Exception)
            {
                return Problem("An unexpected error occurred while deleting the board.");
            }
        }

        private static BoardLibraryItemDto ToDto(BoardLibraryItem item) => new(
            item.Id ?? string.Empty,
            item.Type,
            item.Nickname,
            item.Dictionary,
            item.Units,
            item.Cols,
            item.Rows,
            item.MarkerId,
            item.SquareSize,
            item.MarkerSize,
            item.SquareSizeMm,
            item.MarkerSizeMm,
            item.PreviewSvg,
            item.CreatedAtUtc
        );

        private string? ResolveCurrentUserId()
        {
            return
                User.FindFirstValue(ClaimTypes.NameIdentifier) ??
                User.FindFirstValue("userId") ??
                User.FindFirstValue("uid") ??
                User.FindFirstValue("id");
        }
    }
}
