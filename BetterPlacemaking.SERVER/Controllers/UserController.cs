using BetterPlacemaking.Services;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
	[ApiController]
	[Route("api/[controller]")]
	public class UserController(FirestoreDb db, UserService userService) : ControllerBase
	{
		private readonly UserService _userService = userService;
		private readonly FirestoreDb _db = db;

        [HttpGet]
        public IActionResult GetUsers()
        {
            var response = _userService.GetUsers();
            return Ok(response);
        }
	}
}
