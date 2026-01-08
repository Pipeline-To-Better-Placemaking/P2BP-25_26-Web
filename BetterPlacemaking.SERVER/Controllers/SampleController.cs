using BetterPlacemaking.Services;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
	[ApiController]
	[Route("api/[controller]")]
	public class SampleController(FirestoreDb db, SampleService sampleService) : ControllerBase
	{
		private readonly SampleService _sampleService = sampleService;
		private readonly FirestoreDb _ = db;

		[HttpGet("ping")]
		[ProducesResponseType(typeof(string), 200)]
		[Authorize(Policy = "UserJwt")]
		public IActionResult PingPong()
		{
			string response = _sampleService.SampleServiceMethod();
			return Ok(response);
		}
	}
}
