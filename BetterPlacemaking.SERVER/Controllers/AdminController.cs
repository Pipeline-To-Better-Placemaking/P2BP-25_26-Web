using BetterPlacemaking.Models;
using BetterPlacemaking.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;

namespace BetterPlacemaking.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Roles = "Admin")]
    public class AdminController(AdminService adminService) : ControllerBase
    {
        private readonly AdminService _adminService = adminService;

        [HttpPut("update-role")]
        public IActionResult UpdateRole(
        [FromBody] UpdateRoleRequest request)
        {

            var success = _adminService.UpdateRole(
                request.TargetEmail!,
                request.NewRole!
            );

            if (!success)
                return BadRequest("Failed to update user role");

            return Ok("User role updated successfully");
        }
    }
}
