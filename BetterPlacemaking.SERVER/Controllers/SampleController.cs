using BetterPlacemaking.Services;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Controllers
{
	[ApiController]
	[Route("api/[controller]")]
	public class SampleController(FirestoreDb db, SampleService sampleService) : ControllerBase
	{
		private readonly SampleService _sampleService = sampleService;
		private readonly FirestoreDb _db = db;

		[HttpGet("ping")]
		[ProducesResponseType(typeof(string), 200)]
		public IActionResult PingPong()
		{
			string response = _sampleService.SampleServiceMethod();
			return Ok(response);
		}
	}
}
