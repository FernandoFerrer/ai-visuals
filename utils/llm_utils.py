from haystack_integrations.components.generators.ollama import OllamaGenerator
import pickle
from gradio_client import Client

def generate_text_story_legacy(text_seed):

    story_seed = f"""Given the below short chapter of a story, \
        generate the next short chapter. No more than 5 lines. \
        Make it very short and concise but also interesting and creative. \
        Short Chapter: {text_seed}"""

    llm = OllamaGenerator(model='phi3',
                          generation_kwargs={
                              "num_predict": 150,
                              "temperature": 0.9},
                          streaming_callback=lambda chunk: save_model_response_to_disk(chunk.content))
    result = llm.run(story_seed)
    return result['replies'][0]

def generate_text_story(text_seed):

    story_seed = f"""Given the below short chapter of a story, \
        generate the next short chapter. No more than 5 lines. \
        Make it very short and concise but also interesting and creative. \
        Short Chapter: {text_seed}"""

    client = Client("ysharma/Chat_with_Meta_llama3_8b")
    result = client.predict(
            message=story_seed,
            request=0.95,
            param_3=512,
            api_name="/chat"
    )
    return result

def save_model_response_to_disk(response):
    with open('temp_data/story_response.pkl', 'wb') as f:
        pickle.dump(response, f, pickle.HIGHEST_PROTOCOL)

if __name__ == "__main__":
    from gradio_client import Client

    client = Client("ysharma/Chat_with_Meta_llama3_8b")
    result = client.predict(
            message="Hello!!",
            request=0.95,
            param_3=512,
            api_name="/chat"
    )
    print(result)